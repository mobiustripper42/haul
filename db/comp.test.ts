// Issue 194 — `db:comp`. parseArgs' refusal needs no database. The rest runs `comp()` against a database of this suite's
// own, `<test db>_comp`, created if absent, migrated once, emptied and given the Supper Club before each test. Without a
// reachable Postgres those skip locally and fail in CI (DEC-014). A refusal is `comp()` rejecting; the CLI's exit 1 on
// a rejection is db/seed.ts's shape, untested. Which words a refusal or the success line uses is checked by hand.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveChoices } from "../src/choices.js";
import { asAppRole, createPool } from "../src/adapters/pg-connect.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { cutoffInstant } from "../src/pickup-week.js";
import { requireSupperClub, type ProductWithOptions } from "../src/products.js";
import { comp, COMP_CONSENT_TEXT, parseArgs } from "./comp.js";
import { runSeed } from "./seed.js";

const ERIC = "eric@example.com";
/** Tuesday January 5, 07:00 in Cleveland: January 10's cutoff has passed, January 17's has not. */
const NOW = new Date("2027-01-05T12:00:00.000Z");
/** The first week firstPickup gives as of NOW, the Supper Club's weeks all open. */
const FIRST_WEEK = "2027-01-17";

describe("AC12 — parseArgs refuses --production with no URL", () => {
  it("AC12: --production with no URL throws, so it never falls back to haul_dev", () => {
    expect(() => parseArgs([ERIC, "--production"])).toThrow();
  });

  it("AC12: --production with a URL is read as given", () => {
    const url = "postgres://haul:secret@db.example.invalid:5432/haul";
    expect(parseArgs([ERIC, url, "--production"])).toEqual({ email: ERIC, url, production: true });
  });
});

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`issue 194 — db:comp against <test db>_comp${skipped}`, () => {
  let url: string;
  let pool: ReturnType<typeof createPool>;
  let repo: PostgresRepository;
  let product: ProductWithOptions;

  beforeAll(async () => {
    url = await migrateTestDatabase(TEST_DATABASE_URL, "comp");
    pool = createPool(url);
    repo = new PostgresRepository(asAppRole(url));
  });

  afterAll(async () => {
    await repo?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    const { rows } = await pool.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'");
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
    await runSeed("supper-club", url);
    product = await requireSupperClub(repo);
  });

  /** The member's subscriptions as stored, oldest first. */
  const subscriptionsOf = async (memberId: string) =>
    (
      await pool.query<{
        id: string;
        product_id: string;
        status: string;
        comped: boolean;
        square_card_id: string | null;
        consent_text: string;
        consent_at: Date;
        first_charge_cents: number;
        weekly_cents: number;
      }>(
        `select id, product_id, status, comped, square_card_id, consent_text, consent_at, first_charge_cents, weekly_cents
           from subscriptions where member_id = $1 order by created_at`,
        [memberId],
      )
    ).rows;

  /** Every row of the tables a comp writes or reads, as JSON, in a stable order. */
  const snapshot = async (): Promise<Record<string, unknown[]>> => {
    const out: Record<string, unknown[]> = {};
    for (const table of ["members", "subscriptions", "subscription_options", "ledger"]) {
      const { rows } = await pool.query<{ rows: unknown[] }>(
        `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as rows from "${table}" t`,
      );
      out[table] = rows[0]?.rows ?? [];
    }
    return out;
  };

  /** The member's active Supper Club subscription, its first week paid at signup with a card. */
  const subscribed = async (memberId: string): Promise<void> => {
    const signup = await repo.savePendingSignup({
      memberId,
      productId: product.id,
      choices: resolveChoices(product, {}),
      firstChargeCents: 7400,
      weeklyCents: 7400,
      pickupDate: FIRST_WEEK,
      consentText: "I agree to a weekly charge until I cancel.",
      consentAt: NOW,
    });
    expect(await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, 7400, NOW)).toBe("confirmed");
  };

  describe("AC8 — a comp's rows", () => {
    it("AC8: it writes one active subscription to the Supper Club, comped, with no card, the comp's consent text at now, and 0 cents first and weekly", async () => {
      const memberId = (await repo.createMember({ email: ERIC })).id;
      const { subscriptionId } = await comp([ERIC, url], NOW);
      expect(await subscriptionsOf(memberId)).toEqual([
        {
          id: subscriptionId,
          product_id: product.id,
          status: "active",
          comped: true,
          square_card_id: null,
          consent_text: COMP_CONSENT_TEXT,
          consent_at: NOW,
          first_charge_cents: 0,
          weekly_cents: 0,
        },
      ]);
    });

    it("AC8: its picks are resolveChoices(product, {}), from the first week", async () => {
      const memberId = (await repo.createMember({ email: ERIC })).id;
      await comp([ERIC, url], NOW);
      const { rows } = await pool.query<{ option_type_id: string; option_id: string; from_week: string }>(
        `select so.option_type_id, so.option_id, to_char(so.from_week, 'YYYY-MM-DD') as from_week
           from subscription_options so join subscriptions s on s.id = so.subscription_id
          where s.member_id = $1 order by so.option_type_id`,
        [memberId],
      );
      const expected = Object.entries(resolveChoices(product, {}))
        .map(([option_type_id, option_id]) => ({ option_type_id, option_id, from_week: FIRST_WEEK }))
        .sort((a, b) => a.option_type_id.localeCompare(b.option_type_id));
      expect(rows).toEqual(expected);
    });

    it("AC8: its one ledger row is the first week firstPickup gives as of now, paid at now, 0 cents, with no Square payment; comp returns that week", async () => {
      const memberId = (await repo.createMember({ email: ERIC })).id;
      const result = await comp([ERIC, url], NOW);
      const { rows } = await pool.query(
        `select l.subscription_id, to_char(l.pickup_date, 'YYYY-MM-DD') as pickup_date, l.status, l.amount_cents, l.paid_at, l.square_payment_id
           from ledger l join subscriptions s on s.id = l.subscription_id where s.member_id = $1`,
        [memberId],
      );
      expect(rows).toEqual([
        { subscription_id: result.subscriptionId, pickup_date: FIRST_WEEK, status: "paid", amount_cents: 0, paid_at: NOW, square_payment_id: null },
      ]);
      expect(result.weekOf).toBe(FIRST_WEEK);
    });

    it("AC8: the first week is read with the Supper Club's changed weeks: a closed first week is passed over, as firstPickup passes it", async () => {
      const memberId = (await repo.createMember({ email: ERIC })).id;
      await repo.closePickupWeek(product.id, FIRST_WEEK, null, NOW);
      const result = await comp([ERIC, url], NOW);
      const { rows } = await pool.query(
        "select to_char(l.pickup_date, 'YYYY-MM-DD') as pickup_date from ledger l join subscriptions s on s.id = l.subscription_id where s.member_id = $1",
        [memberId],
      );
      expect(rows).toEqual([{ pickup_date: "2027-01-24" }]);
      expect(result.weekOf).toBe("2027-01-24");
    });

    it("AC8: it is one transaction: a ledger insert that fails leaves no subscription and no picks for the member", async () => {
      const memberId = (await repo.createMember({ email: ERIC })).id;
      await pool.query(
        `create function comp_test_refuse_ledger() returns trigger language plpgsql as $$
         begin raise exception 'the test refuses every ledger insert'; end $$`,
      );
      await pool.query("create trigger comp_test_refuse_ledger before insert on ledger for each row execute function comp_test_refuse_ledger()");
      try {
        await expect(comp([ERIC, url], NOW)).rejects.toThrow(/the test refuses every ledger insert/);
      } finally {
        await pool.query("drop trigger if exists comp_test_refuse_ledger on ledger");
        await pool.query("drop function if exists comp_test_refuse_ledger()");
      }
      expect(await subscriptionsOf(memberId)).toEqual([]);
      const { rows } = await pool.query("select 1 from subscription_options so join subscriptions s on s.id = so.subscription_id where s.member_id = $1", [memberId]);
      expect(rows).toEqual([]);
    });
  });

  it("AC9: a member already holding an active Supper Club subscription is refused, and nothing is written", async () => {
    await subscribed((await repo.createMember({ email: ERIC })).id);
    const before = await snapshot();
    await expect(comp([ERIC, url], NOW)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it("AC10: an email no member has is refused, and nothing is written: no member is created", async () => {
    await repo.createMember({ email: "someone-else@example.com" });
    const before = await snapshot();
    await expect(comp([ERIC, url], NOW)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    expect(await repo.findMemberByEmail(ERIC)).toBeNull();
  });

  it("AC11: a member whose comp was cancelled is comped again: a new comped subscription beside the cancelled one", async () => {
    const memberId = (await repo.createMember({ email: ERIC })).id;
    const first = await comp([ERIC, url], NOW);
    await repo.cancelSubscription(first.subscriptionId, new Date("2027-01-06T12:00:00.000Z"));
    const second = await comp([ERIC, url], new Date("2027-01-07T12:00:00.000Z"));
    expect((await subscriptionsOf(memberId)).map((row) => ({ id: row.id, status: row.status, comped: row.comped }))).toEqual([
      { id: first.subscriptionId, status: "cancelled", comped: true },
      { id: second.subscriptionId, status: "active", comped: true },
    ]);
    expect(second.subscriptionId).not.toBe(first.subscriptionId);
  });

  describe("AC12 — a non-local URL needs --production", () => {
    /** The test database behind a remote host: its `host=` parameter, with `sslmode=disable`, points back at it. */
    const remote = (): string => {
      const parsed = new URL(url);
      const host = parsed.hostname;
      parsed.hostname = "db.example.invalid";
      parsed.searchParams.set("host", host);
      parsed.searchParams.set("sslmode", "disable");
      return parsed.toString();
    };

    it("AC12: a non-local URL without --production is refused, and nothing is written", async () => {
      const memberId = (await repo.createMember({ email: ERIC })).id;
      await expect(comp([ERIC, remote()], NOW)).rejects.toThrow();
      expect(await subscriptionsOf(memberId)).toEqual([]);
    });

    it("AC12: the same URL with --production is not refused: the comp is written", async () => {
      const memberId = (await repo.createMember({ email: ERIC })).id;
      const { subscriptionId } = await comp([ERIC, remote(), "--production"], NOW);
      expect((await subscriptionsOf(memberId)).map((row) => ({ id: row.id, comped: row.comped }))).toEqual([{ id: subscriptionId, comped: true }]);
    });
  });

  it("AC13: the comp is on its first week's pick list with its picks", async () => {
    await repo.createMember({ email: ERIC });
    const { subscriptionId } = await comp([ERIC, url], NOW);
    const choices = resolveChoices(product, {});
    const options = [...product.optionTypes]
      .sort((a, b) => a.position - b.position)
      .map((type) => ({ typeName: type.name, optionName: type.options.find((option) => option.id === choices[type.id])?.name ?? "no such option" }));
    const { boxes } = await repo.listWeekBoxes(product.id, FIRST_WEEK, cutoffInstant(product, FIRST_WEEK));
    expect(boxes.filter((box) => box.subscriptionId === subscriptionId)).toEqual([expect.objectContaining({ subscriptionId, options })]);
  });
});
