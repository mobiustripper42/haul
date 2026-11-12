// Issue 56's tables: subscriptions, subscription_options, ledger and members.square_customer_id. Every test
// runs against a database of this suite's own, `<test db>_signup_tables`, created if absent, migrated once
// and emptied before each test. Issue 138's `dated_picks` migration is read last, on rows from before it, in
// `<test db>_dated_picks`, rebuilt from a temporary directory holding only the migrations before that one, as
// db/member-account.test.ts reads its migration. Without a reachable Postgres they skip locally and fail in CI
// (DEC-014).
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/adapters/pg-connect.js";
import { ensureTestDatabase, migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { migrate, MIGRATIONS_DIR } from "./migrate.js";
import { rebuildDatabase } from "./rebuild.js";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`issue 56 — the signup tables in <test db>_signup_tables${skipped}`, () => {
  let pool: ReturnType<typeof createPool>;
  let memberId: string;
  let productId: string;
  let optionTypeId: string;
  let optionId: string;

  beforeAll(async () => {
    pool = createPool(await migrateTestDatabase(TEST_DATABASE_URL, "signup_tables"));
  });

  afterAll(async () => {
    await pool?.end();
  });

  const id = (rows: Array<{ id: string }>): string => rows[0]?.id ?? "no row";

  beforeEach(async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
    );
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
    memberId = id((await pool.query("insert into members (email) values ('ada@example.com') returning id")).rows);
    productId = id(
      (
        await pool.query(
          "insert into products (name, cap, first_pickup_date, cutoff_weekday, cutoff_time) values ('Box', 50, '2027-01-03', 1, '24:00') returning id",
        )
      ).rows,
    );
    optionTypeId = id((await pool.query("insert into option_types (product_id, name, position) values ($1, 'Size', 1) returning id", [productId])).rows);
    optionId = id(
      (await pool.query("insert into options (option_type_id, name, price_cents, position) values ($1, 'Two', 5000, 1) returning id", [optionTypeId])).rows,
    );
  });

  const subscription = async (status = "pending", member = memberId): Promise<string> =>
    id(
      (
        await pool.query(
          `insert into subscriptions (member_id, product_id, status, consent_text, consent_at, first_charge_cents, weekly_cents)
           values ($1, $2, $3, 'I agree.', now(), 5000, 5000) returning id`,
          [member, productId, status],
        )
      ).rows,
    );

  const ledger = async (subscriptionId: string, status = "pending", pickupDate = "2027-01-03"): Promise<string> =>
    id(
      (
        await pool.query("insert into ledger (subscription_id, pickup_date, amount_cents, status) values ($1, $2, 5000, $3) returning id", [
          subscriptionId,
          pickupDate,
          status,
        ])
      ).rows,
    );

  const anotherMember = async (): Promise<string> =>
    id((await pool.query("insert into members (email) values ($1) returning id", [`${randomUUID()}@example.com`])).rows);

  describe("members.square_customer_id", () => {
    it("AC6: it is null until first payment", async () => {
      const { rows } = await pool.query("select square_customer_id from members where id = $1", [memberId]);
      expect(rows).toEqual([{ square_customer_id: null }]);
    });

    it("AC6: it is unique", async () => {
      const other = await anotherMember();
      await pool.query("update members set square_customer_id = 'CUSTOMER_1' where id = $1", [memberId]);
      await expect(pool.query("update members set square_customer_id = 'CUSTOMER_1' where id = $1", [other])).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });
  });

  describe("subscriptions", () => {
    it("AC7: a subscription starts with no card, an id and a created_at", async () => {
      const subscriptionId = await subscription();
      const { rows } = await pool.query("select id, square_card_id, created_at is not null as created from subscriptions");
      expect(rows).toEqual([{ id: subscriptionId, square_card_id: null, created: true }]);
    });

    it.each(["pending", "active"])("AC7: status %j is accepted", async (status) => {
      expect(await subscription(status)).not.toBe("no row");
    });

    it("AC7: any other status fails a check", async () => {
      await expect(subscription("paused")).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    // Issue 139: a cancel is status 'cancelled' and the time of it, `cancelled_at`, set exactly when cancelled.
    describe("issue 139 — cancelled, and cancelled_at", () => {
      const withCancelledAt = async (status: string, cancelledAt: string | null): Promise<string> =>
        id(
          (
            await pool.query(
              `insert into subscriptions (member_id, product_id, status, consent_text, consent_at, first_charge_cents, weekly_cents, cancelled_at)
               values ($1, $2, $3, 'I agree.', now(), 5000, 5000, $4) returning id`,
              [memberId, productId, status, cancelledAt],
            )
          ).rows,
        );

      it("Data shapes: status 'cancelled' with the time of the cancel is accepted, and cancelled_at holds that time", async () => {
        const subscriptionId = await withCancelledAt("cancelled", "2026-11-20T15:00:00.000Z");
        const { rows } = await pool.query<{ cancelled_at: Date }>("select cancelled_at from subscriptions where id = $1", [subscriptionId]);
        expect(rows).toEqual([{ cancelled_at: new Date("2026-11-20T15:00:00.000Z") }]);
      });

      it("Data shapes: a subscription made with no cancelled_at has it null", async () => {
        const subscriptionId = await subscription("active");
        const { rows } = await pool.query("select cancelled_at from subscriptions where id = $1", [subscriptionId]);
        expect(rows).toEqual([{ cancelled_at: null }]);
      });

      it("Data shapes: status 'cancelled' with cancelled_at null fails a check", async () => {
        await expect(withCancelledAt("cancelled", null)).rejects.toMatchObject({ code: CHECK_VIOLATION });
      });

      it.each(["pending", "active"])("Data shapes: status %j with cancelled_at set fails a check", async (status) => {
        await expect(withCancelledAt(status, "2026-11-20T15:00:00.000Z")).rejects.toMatchObject({ code: CHECK_VIOLATION });
      });
    });

    it("AC11: a second pending row for one member and product is refused", async () => {
      await subscription("pending");
      await expect(subscription("pending")).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it("AC11: another member's pending row is not", async () => {
      await subscription("pending");
      expect(await subscription("pending", await anotherMember())).not.toBe("no row");
    });

    it("AC11: the index limits nothing once a row is active (DEC-026)", async () => {
      await subscription("active");
      await subscription("active");
      expect(await subscription("pending")).not.toBe("no row");
    });
  });

  describe("subscription_options", () => {
    // Issue 138: a set of picks is dated by `from_week`, the Sunday of the first week it applies to.
    const pick = (subscriptionId: string, fromWeek = "2027-01-03") =>
      pool.query("insert into subscription_options (subscription_id, option_type_id, option_id, from_week) values ($1, $2, $3, $4)", [
        subscriptionId,
        optionTypeId,
        optionId,
        fromWeek,
      ]);

    it("AC7: one option per option type: a second row for the type is refused", async () => {
      const subscriptionId = await subscription();
      await pick(subscriptionId);
      await expect(pick(subscriptionId)).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it("AC2 (issue 138): the same type from another week is a row of its own: a later set beside the earlier one", async () => {
      const subscriptionId = await subscription();
      await pick(subscriptionId, "2027-01-03");
      await pick(subscriptionId, "2027-01-24");
      const { rows } = await pool.query("select to_char(from_week, 'YYYY-MM-DD') as from_week from subscription_options order by from_week");
      expect(rows).toEqual([{ from_week: "2027-01-03" }, { from_week: "2027-01-24" }]);
    });

    it("AC2 (issue 138): a row with no from_week is refused", async () => {
      const subscriptionId = await subscription();
      await expect(
        pool.query("insert into subscription_options (subscription_id, option_type_id, option_id, from_week) values ($1, $2, $3, null)", [
          subscriptionId,
          optionTypeId,
          optionId,
        ]),
      ).rejects.toMatchObject({ code: "23502" });
    });

    it("AC7: its audit row's key is the composite primary key", async () => {
      const subscriptionId = await subscription();
      await pick(subscriptionId);
      const { rows } = await pool.query("select row_key from audit_log where table_name = 'subscription_options' and operation = 'insert'");
      expect(rows).toEqual([{ row_key: { subscription_id: subscriptionId, option_type_id: optionTypeId, from_week: "2027-01-03" } }]);
    });
  });

  describe("ledger", () => {
    it("AC7: a row starts on attempt 1, with no payment", async () => {
      await ledger(await subscription());
      const { rows } = await pool.query("select attempt, square_payment_id, paid_at from ledger");
      expect(rows).toEqual([{ attempt: 1, square_payment_id: null, paid_at: null }]);
    });

    it("AC7: pickup_date is a date, keyed by a Cleveland wall-clock day (DEC-017)", async () => {
      const { rows } = await pool.query(
        "select data_type from information_schema.columns where table_schema = 'public' and table_name = 'ledger' and column_name = 'pickup_date'",
      );
      expect(rows).toEqual([{ data_type: "date" }]);
    });

    it.each(["pending", "paid", "declined"])("AC9: status %j is accepted", async (status) => {
      expect(await ledger(await subscription(), status)).not.toBe("no row");
    });

    it("AC9: any other status fails a check", async () => {
      await expect(ledger(await subscription(), "refunded")).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it("AC7: one row per subscription and pickup week", async () => {
      const subscriptionId = await subscription();
      await ledger(subscriptionId);
      await expect(ledger(subscriptionId)).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it("AC7: another week is another row", async () => {
      const subscriptionId = await subscription();
      await ledger(subscriptionId);
      expect(await ledger(subscriptionId, "pending", "2027-01-10")).not.toBe("no row");
    });
  });

  it("AC8: all three tables carry the audit trigger", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc p on p.oid = t.tgfoid
        where p.proname = 'audit_row' and not t.tgisinternal and c.relname in ('subscriptions', 'subscription_options', 'ledger')
        order by c.relname`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(["ledger", "subscription_options", "subscriptions"]);
  });
});

describe.skipIf(!up)(`issue 138 — picks from before the dated_picks migration${skipped}`, () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "haul-dated-picks-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("AC4 (issue 138): each existing pick gets its subscription's earliest ledger week as from_week, so every paid week reads it", async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
    const at = files.findIndex((file) => file.endsWith("_dated_picks.sql"));
    expect(at, "no db/migrations/<timestamp>_dated_picks.sql").toBeGreaterThanOrEqual(0);

    for (const file of files.slice(0, at)) copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    const url = await ensureTestDatabase(TEST_DATABASE_URL, "dated_picks");
    await rebuildDatabase(url, dir);

    const pool = createPool(url);
    try {
      const one = async (sql: string, params: unknown[] = []): Promise<string> => (await pool.query<{ id: string }>(sql, params)).rows[0]?.id ?? "no row";
      const memberId = await one("insert into members (email) values ('old@example.com') returning id");
      const productId = await one(
        "insert into products (name, cap, first_pickup_date, cutoff_weekday, cutoff_time) values ('Box', 50, '2027-01-03', 1, '24:00') returning id",
      );
      const typeId = await one("insert into option_types (product_id, name, position) values ($1, 'Size', 1) returning id", [productId]);
      const optionId = await one("insert into options (option_type_id, name, price_cents, position) values ($1, 'Two', 5000, 1) returning id", [typeId]);
      const subscriptionAt = async (weeks: string[]): Promise<string> => {
        const subscriptionId = await one(
          `insert into subscriptions (member_id, product_id, status, consent_text, consent_at, first_charge_cents, weekly_cents)
           values ($1, $2, 'active', 'I agree.', now(), 5000, 5000) returning id`,
          [memberId, productId],
        );
        await pool.query("insert into subscription_options (subscription_id, option_type_id, option_id) values ($1, $2, $3)", [subscriptionId, typeId, optionId]);
        // The later week written first, so the order they were written in cannot be what picks the earliest.
        for (const week of weeks) await pool.query("insert into ledger (subscription_id, pickup_date, amount_cents, status) values ($1, $2, 5000, 'paid')", [subscriptionId, week]);
        return subscriptionId;
      };
      const ada = await subscriptionAt(["2027-01-17", "2027-01-10"]);
      const grace = await subscriptionAt(["2027-01-24"]);

      const file = files[at] ?? "";
      copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
      await migrate(url, dir);

      const { rows } = await pool.query<{ subscription_id: string; from_week: string }>(
        "select subscription_id, to_char(from_week, 'YYYY-MM-DD') as from_week from subscription_options",
      );
      expect(rows.sort((a, b) => a.from_week.localeCompare(b.from_week))).toEqual([
        { subscription_id: ada, from_week: "2027-01-10" },
        { subscription_id: grace, from_week: "2027-01-24" },
      ]);
    } finally {
      await pool.end();
    }
  }, 20_000); // A rebuild beside other suites' rebuilds has taken over 5 seconds (issue 94), as db/member-account.test.ts allows.
});
