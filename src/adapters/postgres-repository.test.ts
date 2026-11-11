// The Repository contract against real Postgres (AC7), in a database of its own (AC9):
// `<test db>_repository`, created if absent, migrated once, truncated before each test.
// Without a reachable Postgres it skips locally and fails in CI (AC8).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor, PendingSignup } from "../ports/repository.js";
import type { ProductInput, ProductWithOptions } from "../products.js";
import { hashCode, issueSignInCode } from "../sign-in/code.js";
import { runSignInStoreContract } from "../sign-in/store-contract.js";
import { createPool } from "./pg-connect.js";
import { PostgresRepository } from "./postgres-repository.js";
import { runRepositoryContract, runWeekCreditContract } from "./repository-contract.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "./test-database.js";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC9 — Postgres contract in <test db>_repository${skipped}`, () => {
  let pool: ReturnType<typeof createPool>;
  let repo: PostgresRepository;

  beforeAll(async () => {
    const url = await migrateTestDatabase(TEST_DATABASE_URL, "repository");
    pool = createPool(url);
    repo = new PostgresRepository(url);
  });

  afterAll(async () => {
    await repo?.close();
    await pool?.end();
  });

  // Every table but the migration ledger, read from the catalog so a later migration's table
  // can't be missed. Truncating `_migrations` would make the next `migrate` replay everything.
  const truncateAll = async (): Promise<void> => {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
    );
    if (rows.length === 0) return;
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  };

  // Issue 71, AC5: the actor of each event row, decoded from `member:<uuid>` / `system:<name>` / null.
  const eventActors = async (): Promise<Actor[]> =>
    (await pool.query<{ actor: string | null }>("select actor from audit_log where operation = 'event' order by id")).rows.map(
      ({ actor }) => {
        if (actor === null) return null;
        if (actor.startsWith("member:")) return { member: actor.slice("member:".length) };
        if (actor.startsWith("system:")) return { system: actor.slice("system:".length) };
        throw new Error(`audit_log.actor ${JSON.stringify(actor)} is neither member:<uuid>, system:<name> nor null`);
      },
    );

  runRepositoryContract("postgres", async () => repo, eventActors, truncateAll);

  // Issue 9, AC16–AC19: the sign-in store contract, a subject being a real member row.
  runSignInStoreContract(
    "postgres",
    async () => ({ store: repo, makeSubject: async (email) => (await repo.createMember({ email })).id }),
    truncateAll,
  );

  // Issue 149: the week credit contract's seams, as raw SQL. A product is inserted row by row and read back.
  const addProduct = async (input: ProductInput): Promise<ProductWithOptions> => {
    const product = await pool.query<{ id: string }>(
      `insert into products (name, cap, first_pickup_date, cutoff_weekday, cutoff_time)
       values ($1, $2, $3, $4, $5) returning id`,
      [input.name, input.cap, input.firstPickupDate, input.cutoffWeekday, input.cutoffTime],
    );
    for (const type of input.optionTypes) {
      const row = await pool.query<{ id: string }>("insert into option_types (product_id, name, position) values ($1, $2, $3) returning id", [
        product.rows[0]?.id,
        type.name,
        type.position,
      ]);
      for (const option of type.options) {
        await pool.query("insert into options (option_type_id, name, price_cents, position) values ($1, $2, $3, $4)", [
          row.rows[0]?.id,
          option.name,
          option.priceCents,
          option.position,
        ]);
      }
    }
    const found = await repo.findProductByName(input.name);
    expect(found, `findProductByName found nothing for the rows just inserted for ${input.name}`).not.toBeNull();
    return found as ProductWithOptions;
  };

  /** A ledger row as the charge run writes it: a paid row carries its payment's time. */
  const addLedgerRow = async (subscriptionId: string, pickupDate: string, status: PendingSignup["ledgerStatus"], amountCents: number): Promise<void> => {
    await pool.query(
      `insert into ledger (subscription_id, pickup_date, amount_cents, status, paid_at)
       values ($1, $2::date, $3, $4, case when $4 = 'paid' then '2027-01-11T15:00:00Z'::timestamptz end)`,
      [subscriptionId, pickupDate, amountCents, status],
    );
  };

  /** The subscription's picks replaced, one option per option type, as a switch would. */
  const setSubscriptionOptions = async (subscriptionId: string, optionIds: string[]): Promise<void> => {
    await pool.query("delete from subscription_options where subscription_id = $1", [subscriptionId]);
    await pool.query(
      `insert into subscription_options (subscription_id, option_type_id, option_id)
       select $1, o.option_type_id, o.id from options o where o.id = any ($2::uuid[])`,
      [subscriptionId, optionIds],
    );
  };

  /** Issue 155: a week credit spent on a later week's ledger row, as the charge run (2.2b) will spend one. */
  const spendWeekCredit = async (weekCreditId: string, ledgerId: string): Promise<void> => {
    const { rowCount } = await pool.query("update week_credits set spent_on = $2 where id = $1", [weekCreditId, ledgerId]);
    expect(rowCount, `no week credit ${weekCreditId} to spend`).toBe(1);
  };

  runWeekCreditContract("postgres", async () => repo, addProduct, addLedgerRow, setSubscriptionOptions, spendWeekCredit, truncateAll);

  // Issue 149: Postgres only. Closing and confirming take the product row's lock, so whichever lands second sees
  // the other; and a week credit's options go with it.
  describe("issue 149 — week credits under concurrency and in their tables", () => {
    const BOX: ProductInput = {
      name: "Box",
      cap: 50,
      firstPickupDate: "2027-01-03",
      cutoffWeekday: 1,
      cutoffTime: "24:00:00",
      optionTypes: [
        { name: "How many people?", position: 1, options: [{ name: "2 people", priceCents: 5000, position: 1 }] },
        { name: "Which menu?", position: 2, options: [{ name: "Standard", priceCents: 0, position: 1 }] },
      ],
    };
    const CONSENT_AT = new Date("2027-01-05T15:00:00.000Z");
    const CLOSED_AT = new Date("2027-01-12T15:00:00.000Z");
    const PAID_AT = new Date("2027-01-12T15:00:01.000Z");

    const pendingFor = async (product: ProductWithOptions, email: string, week: string): Promise<PendingSignup> => {
      const member = await repo.createMember({ email });
      return repo.savePendingSignup({
        memberId: member.id,
        productId: product.id,
        choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
        firstChargeCents: 5000,
        weeklyCents: 5000,
        pickupDate: week,
        consentText: "I agree to a weekly charge of $50.",
        consentAt: CONSENT_AT,
      });
    };

    const confirm = (signup: PendingSignup) => repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, PAID_AT);

    it("AC12: a close and a paid confirmation that run together leave exactly one week credit, whichever lands first", async () => {
      await truncateAll();
      const product = await addProduct(BOX);
      const weeks = Array.from({ length: 8 }, (_, i) => new Date(Date.parse("2027-01-10T00:00:00Z") + i * 7 * 86_400_000).toISOString().slice(0, 10));
      for (const [i, week] of weeks.entries()) {
        const signup = await pendingFor(product, `race-${i}@example.com`, week);
        await Promise.all([repo.closePickupWeek(product.id, week, null, CLOSED_AT), confirm(signup)]);
      }
      const granted = await Promise.all(weeks.map(async (week) => (await repo.listWeekCredits(product.id, week)).length));
      expect(granted).toEqual(weeks.map(() => 1));
    });

    it("AC5: five closes of one week at once grant one week credit per paid row, and none fails", async () => {
      await truncateAll();
      const product = await addProduct(BOX);
      for (const email of ["ada@example.com", "grace@example.com"]) {
        const signup = await pendingFor(product, email, "2027-01-24");
        expect(await confirm(signup)).toBe("confirmed");
      }
      const closes = await Promise.allSettled(Array.from({ length: 5 }, () => repo.closePickupWeek(product.id, "2027-01-24", "Kitchen flooded", CLOSED_AT)));
      expect(closes.map((close) => close.status)).toEqual(closes.map(() => "fulfilled"));
      expect(await repo.listWeekCredits(product.id, "2027-01-24")).toHaveLength(2);
    });

    it("AC4, AC7: a week credit's picks are kept beside it, and go when reopening withdraws it", async () => {
      await truncateAll();
      const product = await addProduct(BOX);
      const signup = await pendingFor(product, "ada@example.com", "2027-01-24");
      expect(await confirm(signup)).toBe("confirmed");
      await repo.closePickupWeek(product.id, "2027-01-24", null, CLOSED_AT);
      const options = async () => Number((await pool.query<{ n: string }>("select count(*) as n from week_credit_options")).rows[0]?.n);
      expect(await options()).toBe(2);
      await repo.reopenPickupWeek(product.id, "2027-01-24");
      expect(await options()).toBe(0);
    });
  });

  // Issue 9: Postgres only. Each claim, consume and increment is one atomic statement, so
  // concurrent callers cannot pass a cap together.
  describe("issue 9 — sign-in store under concurrency", () => {
    const T0 = new Date("2026-10-28T14:00:00.000Z");
    const MINUTE = 60_000;
    const DAY = 24 * 60 * MINUTE;
    const RIGHT = "a".repeat(64);
    const WRONG = "f".repeat(64);

    const memberWithCode = async (): Promise<string> => {
      const { id } = await repo.createMember({ email: "ada@example.com" });
      await repo.saveSignInCode({
        subjectId: id,
        codeHash: RIGHT,
        createdAt: T0,
        expiresAt: new Date(T0.getTime() + 10 * MINUTE),
      });
      return id;
    };

    it("AC17 (issue 9): two concurrent consumeSignInCode calls on one code return exactly one true", async () => {
      await truncateAll();
      const id = await memberWithCode();
      const now = new Date(T0.getTime() + MINUTE);
      const results = await Promise.all([repo.consumeSignInCode(id, now), repo.consumeSignInCode(id, now)]);
      expect(results.filter((won) => won)).toHaveLength(1);
    });

    it("AC18 (issue 9): 10 concurrent wrong-guess claims with maxAttempts 3 return exactly 3 non-null results, leaving attempts 3 and failedInWindow 3", async () => {
      await truncateAll();
      const id = await memberWithCode();
      const now = new Date(T0.getTime() + MINUTE);
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          repo.claimSignInAttempt(id, { presentedHash: WRONG, maxAttempts: 3, now, windowMs: DAY, maxFailures: 50 }),
        ),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(3);
      expect(await repo.getSignInCode(id)).toMatchObject({ attempts: 3, failedInWindow: 3 });
    });

    it("AC19 (issue 9): 25 concurrent incrementRateLimit calls on one window return 1 through 25, each exactly once", async () => {
      await truncateAll();
      const windowStart = T0;
      const expiresAt = new Date(T0.getTime() + 60 * MINUTE);
      const now = new Date(T0.getTime() + MINUTE);
      const counts = await Promise.all(
        Array.from({ length: 25 }, () =>
          repo.incrementRateLimit("sign-in-request", "203.0.113.7", windowStart, expiresAt, now),
        ),
      );
      expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    });
  });

  // Issue 22: Postgres only. The lock, the hold and the redeem are each decided in one atomic
  // statement, so callers that arrive together cannot pass them together.
  describe("issue 22 — the lock, the hold and the link under concurrency", () => {
    const T0 = new Date("2026-10-28T14:00:00.000Z");
    const MINUTE = 60_000;
    const DAY = 24 * 60 * MINUTE;
    const RIGHT = "a".repeat(64);
    const WRONG = "f".repeat(64);
    const LINK = "c".repeat(64);

    const member = async () => repo.createMember({ email: "ada@example.com" });
    const saveCode = (subjectId: string, createdAt: Date) =>
      repo.saveSignInCode({ subjectId, codeHash: RIGHT, createdAt, expiresAt: new Date(createdAt.getTime() + 10 * MINUTE) });

    it("AC6: 10 concurrent wrong-guess claims with maxAttempts 10 and maxFailures 5 return exactly 5 non-null results, one of them carrying failedInWindow 5, and leave failedInWindow 5", async () => {
      await truncateAll();
      const { id } = await member();
      await saveCode(id, T0);
      const now = new Date(T0.getTime() + MINUTE);
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          repo.claimSignInAttempt(id, { presentedHash: WRONG, maxAttempts: 10, now, windowMs: DAY, maxFailures: 5 }),
        ),
      );
      const claimed = results.filter((r) => r !== null);
      expect(claimed).toHaveLength(5);
      expect(claimed.filter((r) => r.failedInWindow === 5)).toHaveLength(1);
      expect(await repo.getSignInCode(id)).toMatchObject({ failedInWindow: 5 });
    });

    it("AC33: 10 concurrent issueSignInCode calls outside the wait store exactly one code and return { send: 'code' } exactly once", async () => {
      await truncateAll();
      const subject = await member();
      const codes = Array.from({ length: 10 }, (_, i) => String(300000 + i));
      const outcomes = await Promise.all(
        codes.map((code) =>
          issueSignInCode(repo, { subject, code, codeHash: hashCode(code) }, { now: T0, mintLinkToken: () => "tok-never" }),
        ),
      );
      const sent = codes.filter((_, i) => outcomes[i]?.send === "code");
      expect(sent).toHaveLength(1);
      expect(outcomes.filter((o) => o.send === "nothing")).toHaveLength(9);
      expect((await repo.getSignInCode(subject.id))?.codeHash).toBe(hashCode(sent[0] ?? "none sent"));
    });

    it("AC33: for a locked member, 10 concurrent issueSignInCode calls save exactly one link and return { send: 'link' } exactly once", async () => {
      await truncateAll();
      const subject = await member();
      await saveCode(subject.id, T0);
      for (let g = 1; g <= 5; g++) {
        await repo.claimSignInAttempt(subject.id, {
          presentedHash: WRONG,
          maxAttempts: 5,
          now: new Date(T0.getTime() + g * 1000),
          windowMs: DAY,
          maxFailures: 5,
        });
      }
      const before = await repo.getSignInCode(subject.id);
      expect(before).toMatchObject({ codeHash: RIGHT, failedInWindow: 5 });

      const now = new Date(T0.getTime() + 10 * MINUTE);
      const outcomes = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          issueSignInCode(
            repo,
            { subject, code: String(300000 + i), codeHash: hashCode(String(300000 + i)) },
            { now, mintLinkToken: () => `tok-${i}` },
          ),
        ),
      );
      const links = outcomes.flatMap((o) => (o.send === "link" ? [o.token] : []));
      expect(links).toHaveLength(1);
      expect(outcomes.filter((o) => o.send === "nothing")).toHaveLength(9);
      expect(await repo.getSignInCode(subject.id)).toMatchObject({
        codeHash: RIGHT,
        linkHash: hashCode(links[0] ?? "none sent"),
        linkCreatedAt: now,
      });
    });

    it("AC14: two concurrent redeemSignInLink calls for one link return the subject id exactly once", async () => {
      await truncateAll();
      const { id } = await member();
      await saveCode(id, T0);
      await repo.saveSignInLink({ subjectId: id, linkHash: LINK, createdAt: T0, expiresAt: new Date(T0.getTime() + 10 * MINUTE) });
      const now = new Date(T0.getTime() + MINUTE);
      const results = await Promise.all([repo.redeemSignInLink(LINK, now), repo.redeemSignInLink(LINK, now)]);
      expect(results.filter((r) => r !== null)).toEqual([id]);
    });
  });

  // Issue 34: recordEvent writes one audit_log event row through audit_event().
  describe("issue 34 — recordEvent writes an event row to audit_log", () => {
    type EventRow = {
      table_name: string;
      operation: string;
      event: string | null;
      row_key: Record<string, unknown>;
      before: unknown;
      after: unknown;
      actor: string | null;
      db_user: string;
    };

    const eventRows = async (): Promise<EventRow[]> =>
      (
        await pool.query<EventRow>(
          `select table_name, operation, event, row_key, before, after, actor, db_user
             from audit_log where operation = 'event' order by id`,
        )
      ).rows;

    const sessionUser = async (): Promise<string> =>
      (await pool.query<{ u: string }>("select session_user::text as u")).rows[0]?.u ?? "no session user";

    it.each(["sign_in_by_code", "sign_in_by_link", "lock"] as const)(
      "AC6: a member's %s event is one row — operation 'event', that event, table members, row_key { id }, no before or after, actor null, db_user the session user",
      async (kind) => {
        await truncateAll();
        const { id } = await repo.createMember({ email: "ada@example.com" });
        await repo.recordEvent({ kind, memberId: id });
        expect(await eventRows()).toEqual([
          {
            table_name: "members",
            operation: "event",
            event: kind,
            row_key: { id },
            before: null,
            after: null,
            actor: null,
            db_user: await sessionUser(),
          },
        ]);
      },
    );

    it("AC6: a rate_limit_refusal event is one row on rate_limit_hits whose row_key is the counter's primary key — bucket, key, window_start", async () => {
      await truncateAll();
      const windowStart = new Date("2026-10-28T14:00:00.000Z");
      await repo.recordEvent({ kind: "rate_limit_refusal", bucket: "sign-in-request", key: "203.0.113.7", windowStart });

      const rows = await eventRows();
      expect(rows).toEqual([
        expect.objectContaining({
          table_name: "rate_limit_hits",
          operation: "event",
          event: "rate_limit_refusal",
          before: null,
          after: null,
          actor: null,
          db_user: await sessionUser(),
        }),
      ]);
      const pk = await pool.query<{ attname: string }>(
        `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
          where i.indrelid = 'public.rate_limit_hits'::regclass and i.indisprimary order by a.attname`,
      );
      expect(Object.keys(rows[0]?.row_key ?? {}).sort()).toEqual(pk.rows.map((r) => r.attname));
      expect(rows[0]?.row_key).toMatchObject({ bucket: "sign-in-request", key: "203.0.113.7" });
      const { rows: instant } = await pool.query<{ window_start: Date }>(
        "select (row_key->>'window_start')::timestamptz as window_start from audit_log where operation = 'event'",
      );
      expect(instant).toEqual([{ window_start: windowStart }]);
    });

    it("AC7: a member created, then signed in by code, then given a new language reads back, by table and row_key in id order, as the insert, the sign_in_by_code event and the update", async () => {
      await truncateAll();
      const { id } = await repo.createMember({ email: "ada@example.com" });
      await repo.recordEvent({ kind: "sign_in_by_code", memberId: id });
      await pool.query("update members set language = 'es' where id = $1", [id]);

      const { rows } = await pool.query<{ operation: string; event: string | null }>(
        "select operation, event from audit_log where table_name = 'members' and row_key = $1::jsonb order by id",
        [JSON.stringify({ id })],
      );
      expect(rows).toEqual([
        { operation: "insert", event: null },
        { operation: "event", event: "sign_in_by_code" },
        { operation: "update", event: null },
      ]);
    });
  });

  // Issue 55: Postgres only. saveAccount is one statement, so callers that arrive together cannot make
  // two rows, and a member's insert and update are the row changes the trigger records (DEC-028).
  describe("issue 55 — saveAccount under concurrency and in the audit log", () => {
    const ADA = { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" } as const;
    const OTHER = { firstName: "Augusta", lastName: "King", phone: "216-555-0199", language: "es" } as const;
    const CONFIRMED_AT = new Date("2026-10-28T13:00:00.000Z");

    const rowChanges = async (id: string) =>
      (
        await pool.query<{ operation: string; actor: string | null }>(
          "select operation, actor from audit_log where table_name = 'members' and row_key = $1::jsonb order by id",
          [JSON.stringify({ id })],
        )
      ).rows;

    it("AC5: 10 concurrent saveAccount calls for a new email make one row, none fails, and every call returns that member", async () => {
      await truncateAll();
      const members = await Promise.all(Array.from({ length: 10 }, () => repo.saveAccount(ADA)));
      const { rows } = await pool.query<{ id: string }>("select id from members where email = $1", [ADA.email]);
      expect(rows).toHaveLength(1);
      expect(new Set(members.map((member) => member.id))).toEqual(new Set([rows[0]?.id]));
    });

    it("AC7: 10 concurrent saveAccount calls for a confirmed member change nothing, and every call returns it as stored", async () => {
      await truncateAll();
      const { id } = await repo.saveAccount(ADA);
      await repo.confirmMemberEmail(id, CONFIRMED_AT);
      const stored = await repo.findMemberById(id);
      expect(stored?.emailConfirmedAt).toEqual(CONFIRMED_AT);
      const members = await Promise.all(Array.from({ length: 10 }, () => repo.saveAccount({ ...ADA, ...OTHER })));
      for (const member of members) expect(member).toEqual(stored);
      expect(await repo.findMemberById(id)).toEqual(stored);
    });

    it("AC5: a new member through withActor(null) is one insert row in audit_log, with a null actor", async () => {
      await truncateAll();
      const { id } = await repo.withActor(null, (scoped) => scoped.saveAccount(ADA));
      expect(await rowChanges(id)).toEqual([{ operation: "insert", actor: null }]);
    });

    it("AC6: a replacement is one update row in audit_log", async () => {
      await truncateAll();
      const { id } = await repo.withActor(null, (scoped) => scoped.saveAccount(ADA));
      await repo.withActor(null, (scoped) => scoped.saveAccount({ ...ADA, ...OTHER }));
      expect(await rowChanges(id)).toEqual([
        { operation: "insert", actor: null },
        { operation: "update", actor: null },
      ]);
    });

    it("AC7: saving over a confirmed member writes no row change", async () => {
      await truncateAll();
      const { id } = await repo.saveAccount(ADA);
      await repo.confirmMemberEmail(id, CONFIRMED_AT);
      const before = await rowChanges(id);
      expect(before.map((change) => change.operation)).toEqual(["insert", "update"]);
      await repo.saveAccount({ ...ADA, ...OTHER });
      expect(await rowChanges(id)).toEqual(before);
    });

    it("AC8: a second confirmMemberEmail writes no row change", async () => {
      await truncateAll();
      const { id } = await repo.saveAccount(ADA);
      await repo.confirmMemberEmail(id, CONFIRMED_AT);
      await repo.confirmMemberEmail(id, new Date(CONFIRMED_AT.getTime() + 60_000));
      expect((await rowChanges(id)).map((change) => change.operation)).toEqual(["insert", "update"]);
    });
  });

  // Issue 59: rows the in-memory adapter cannot hold, so the contract cannot reach them.
  describe("issue 59 — listSubscribers over rows only Postgres holds", () => {
    /** A product with one option type and one option, by raw insert. */
    const addProductRows = async () => {
      const product = await pool.query<{ id: string }>(
        `insert into products (name, cap, first_pickup_date, cutoff_weekday, cutoff_time)
         values ('Supper Club', 50, '2027-01-03', 1, '24:00') returning id`,
      );
      const type = await pool.query<{ id: string }>(
        "insert into option_types (product_id, name, position) values ($1, 'Which menu?', 1) returning id",
        [product.rows[0]?.id],
      );
      const option = async (name: string, position: number) =>
        (
          await pool.query<{ id: string }>("insert into options (option_type_id, name, price_cents, position) values ($1, $2, 0, $3) returning id", [
            type.rows[0]?.id,
            name,
            position,
          ])
        ).rows[0]?.id;
      return { productId: product.rows[0]?.id, typeId: type.rows[0]?.id, standard: await option("Standard", 1), vegan: await option("Vegan", 2) };
    };

    /** An active subscription with its pick, and no ledger rows yet. */
    const addActive = async (memberId: string, productId: string | undefined, typeId: string | undefined, optionId: string | undefined): Promise<string> => {
      const { rows } = await pool.query<{ id: string }>(
        `insert into subscriptions (member_id, product_id, status, consent_text, consent_at, first_charge_cents, weekly_cents)
         values ($1, $2, 'active', 'I agree.', '2026-11-01T12:00:00Z', 5000, 5000) returning id`,
        [memberId, productId],
      );
      const id = rows[0]?.id as string;
      await pool.query("insert into subscription_options (subscription_id, option_type_id, option_id) values ($1, $2, $3)", [id, typeId, optionId]);
      return id;
    };

    const addLedger = (subscriptionId: string, pickupDate: string, status: string, paidAt: string | null) =>
      pool.query("insert into ledger (subscription_id, pickup_date, amount_cents, status, paid_at) values ($1, $2, 5000, $3, $4)", [
        subscriptionId,
        pickupDate,
        status,
        paidAt,
      ]);

    it("AC11: joined is the first paid row of several, in Cleveland, and the subscription is one row", async () => {
      await truncateAll();
      const { productId, typeId, standard } = await addProductRows();
      const ada = await repo.createMember({ email: "ada@example.com" });
      const subscriptionId = await addActive(ada.id, productId, typeId, standard);
      // The last written first, so the order they were written in cannot be what picks the first.
      await addLedger(subscriptionId, "2026-12-20", "paid", "2026-12-16T15:00:00Z");
      await addLedger(subscriptionId, "2026-12-13", "paid", "2026-12-09T15:00:00Z");
      await addLedger(subscriptionId, "2026-12-06", "paid", "2026-12-02T03:30:00Z");
      // An earlier week that was never paid is not the first paid row.
      await addLedger(subscriptionId, "2026-11-29", "declined", null);

      expect(await repo.listSubscribers(productId as string)).toEqual([expect.objectContaining({ subscriptionId, joinedDate: "2026-12-01" })]);
    });

    it("AC3: a member holding two active subscriptions gets two rows, each with its own meal and date (DEC-026)", async () => {
      await truncateAll();
      const { productId, typeId, standard, vegan } = await addProductRows();
      const ada = await repo.createMember({ email: "ada@example.com" });
      const first = await addActive(ada.id, productId, typeId, standard);
      const second = await addActive(ada.id, productId, typeId, vegan);
      await addLedger(first, "2026-12-06", "paid", "2026-12-01T17:00:00Z");
      await addLedger(second, "2026-12-13", "paid", "2026-12-08T17:00:00Z");

      const rows = await repo.listSubscribers(productId as string);

      expect(rows.map(({ subscriptionId, options, joinedDate }) => ({ subscriptionId, options, joinedDate })).sort((a, b) => a.joinedDate.localeCompare(b.joinedDate))).toEqual([
        { subscriptionId: first, options: [{ typeName: "Which menu?", optionName: "Standard" }], joinedDate: "2026-12-01" },
        { subscriptionId: second, options: [{ typeName: "Which menu?", optionName: "Vegan" }], joinedDate: "2026-12-08" },
      ]);
    });
  });

  // Postgres only: the typed port gives the in-memory adapter no way to store an unsupported code.
  describe("AC10 (issue 7) — members.language accepts only en and es", () => {
    const CHECK_VIOLATION = "23514";

    it.each(["ES", "fr"])("AC10 (issue 7): a raw insert with language %j fails with a check violation", async (language) => {
      await truncateAll();
      const insert = pool.query("insert into members (email, language) values ($1, $2)", [
        "ada@example.com",
        language,
      ]);
      await expect(insert).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  // Postgres only: the typed port gives the in-memory adapter no way to store an unsupported role.
  describe("AC2 (issue 10) — members.role defaults to member and accepts only ROLES", () => {
    const CHECK_VIOLATION = "23514";

    it("AC2 (issue 10): a raw insert that names no role reads back role member", async () => {
      await truncateAll();
      await pool.query("insert into members (email) values ($1)", ["ada@example.com"]);
      // Read through to_jsonb so a missing column reads as null rather than erroring.
      const { rows } = await pool.query<{ role: string | null }>(
        "select to_jsonb(m) ->> 'role' as role from members m where email = $1",
        ["ada@example.com"],
      );
      expect(rows).toEqual([{ role: "member" }]);
    });

    it.each(["owner", "Admin"])("AC2 (issue 10): a raw insert with role %j fails with a check violation", async (role) => {
      await truncateAll();
      const insert = pool.query("insert into members (email, role) values ($1, $2)", ["ada@example.com", role]);
      await expect(insert).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });
});
