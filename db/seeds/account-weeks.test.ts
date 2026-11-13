// Issue 155, AC11: the `account-weeks` seed AC10's by-hand check starts from, in a database of this suite's own,
// `<test db>_account_weeks`, emptied before each test. The rules every seed keeps (alone, twice, stacked, only its
// own rows) run on it in db/seed.test.ts. Without a reachable Postgres these skip locally and fail in CI (DEC-014).
//
// The seed works its weeks out from now, so these do too, from the clock read just before it runs; a run that
// straddles a Monday's midnight cutoff would see one week differently. "Past" is AC6's: a week whose last pickup
// day has passed in Cleveland. Dates are read as text, so `pg` hands back what Postgres stores.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPool } from "../../src/adapters/pg-connect.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../../src/adapters/test-database.js";
import { clevelandDate, cutoffInstant, pickupWeek } from "../../src/pickup-week.js";
import type { ProductWithOptions } from "../../src/products.js";
import { runSeed } from "../seed.js";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

const EMAIL = "weeks.member@example.com";
const OCT_25 = "2026-10-25";

const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!up)(`AC11 — the account-weeks seed against <test db>_account_weeks${skipped}`, () => {
  let url: string;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    url = await migrateTestDatabase(TEST_DATABASE_URL, "account_weeks");
    pool = createPool(url);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
    );
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  });

  /**
   * The seed run now, and what it should have made: the Sundays from October 25 through the latest whose cutoff has
   * passed, the past ones among them, and the member's subscription as stored.
   */
  const seeded = async () => {
    const now = new Date();
    await runSeed("account-weeks", url);

    const product = (
      await pool.query<{ id: string; cutoff_weekday: number; cutoff_time: string }>(
        "select id, cutoff_weekday, cutoff_time::text as cutoff_time from products where name = 'Supper Club'",
      )
    ).rows[0];
    if (!product) throw new Error("the seed left no Supper Club product");
    const settings: ProductWithOptions = {
      id: product.id,
      name: "Supper Club",
      cap: 0,
      firstPickupDate: OCT_25,
      cutoffWeekday: product.cutoff_weekday,
      cutoffTime: product.cutoff_time,
      optionTypes: [],
    };
    const charged: string[] = [];
    for (let sunday = OCT_25; cutoffInstant(settings, sunday).getTime() <= now.getTime(); sunday = addDays(sunday, 7)) charged.push(sunday);
    const today = clevelandDate(now);
    const past = charged.filter((sunday) => pickupWeek(sunday, null).lastDay < today);

    const subscriptions = (
      await pool.query<{ id: string; status: string }>(
        `select s.id, s.status
           from subscriptions s
           join members m on m.id = s.member_id
           join products p on p.id = s.product_id
          where m.email = $1 and p.name = 'Supper Club'`,
        [EMAIL],
      )
    ).rows;
    return { productId: product.id, charged, past, latestPast: past.at(-1), subscriptions, subscriptionId: subscriptions[0]?.id ?? "" };
  };

  const paidWeeks = async (subscriptionId: string): Promise<string[]> =>
    (
      await pool.query<{ week: string }>(
        "select to_char(pickup_date, 'YYYY-MM-DD') as week from ledger where subscription_id = $1 and status = 'paid' order by pickup_date",
        [subscriptionId],
      )
    ).rows.map((row) => row.week);

  const closedWeeks = async (productId: string): Promise<string[]> =>
    (
      await pool.query<{ week: string }>(
        "select to_char(week_of, 'YYYY-MM-DD') as week from pickup_weeks where product_id = $1 and closed_at is not null order by week_of",
        [productId],
      )
    ).rows.map((row) => row.week);

  const picksOf = async (table: "subscription_options" | "week_credit_options", column: "subscription_id" | "week_credit_id", id: string) =>
    (await pool.query<{ type: string; option: string }>(`select option_type_id as type, option_id as option from ${table} where ${column} = $1 order by option_type_id`, [id])).rows;

  it("AC11: weeks.member@example.com holds one active Supper Club subscription, with a pick for each option type", async () => {
    const { subscriptions, subscriptionId, productId } = await seeded();
    expect(subscriptions.map((s) => s.status)).toEqual(["active"]);
    const types = (await pool.query("select id from option_types where product_id = $1", [productId])).rows;
    expect(types.length).toBeGreaterThan(0);
    expect(await picksOf("subscription_options", "subscription_id", subscriptionId)).toHaveLength(types.length);
  });

  it("AC4 (issue 138): the subscription's one set of picks starts from its first ledger week, October 25, so every paid week reads it", async () => {
    const { subscriptionId } = await seeded();
    const { rows } = await pool.query<{ from_week: string }>(
      "select distinct to_char(from_week, 'YYYY-MM-DD') as from_week from subscription_options where subscription_id = $1",
      [subscriptionId],
    );
    expect(rows).toEqual([{ from_week: OCT_25 }]);
  });

  it("AC11: paid rows for every week from October 25 through the latest week whose cutoff has passed, except one past week, neither October 25 nor the latest", async () => {
    const { subscriptionId, charged, past, latestPast } = await seeded();
    const paid = await paidWeeks(subscriptionId);
    expect(paid.filter((week) => !charged.includes(week))).toEqual([]);
    const missing = charged.filter((week) => !paid.includes(week));
    expect(missing).toHaveLength(1);
    expect(past).toContain(missing[0]);
    expect(missing[0]).not.toBe(OCT_25);
    expect(missing[0]).not.toBe(latestPast);
  });

  it("AC11: that past week is closed, with no paid row", async () => {
    const { productId, subscriptionId, charged } = await seeded();
    const paid = await paidWeeks(subscriptionId);
    const missing = charged.filter((week) => !paid.includes(week));
    expect(missing).toHaveLength(1);
    expect(await closedWeeks(productId)).toContain(missing[0]);
  });

  it("AC11: the latest past week is closed with its paid row, and one unspent week credit granted for that row, holding the subscription's picks", async () => {
    const { productId, subscriptionId, latestPast } = await seeded();
    expect(latestPast).toBeDefined();
    expect(await paidWeeks(subscriptionId)).toContain(latestPast);
    expect(await closedWeeks(productId)).toContain(latestPast);

    const credits = (
      await pool.query<{ id: string; spent_on: string | null; granted_week: string; status: string }>(
        `select c.id, c.spent_on, to_char(l.pickup_date, 'YYYY-MM-DD') as granted_week, l.status
           from week_credits c join ledger l on l.id = c.granted_for
          where c.subscription_id = $1`,
        [subscriptionId],
      )
    ).rows;
    expect(credits.map(({ spent_on, granted_week, status }) => ({ spent_on, granted_week, status }))).toEqual([
      { spent_on: null, granted_week: latestPast, status: "paid" },
    ]);
    const picks = await picksOf("subscription_options", "subscription_id", subscriptionId);
    expect(picks.length).toBeGreaterThan(0);
    expect(await picksOf("week_credit_options", "week_credit_id", credits[0]?.id ?? "")).toEqual(picks);
  });

  // Issue 150, AC11: a by-hand charge run (AC12) spends weeks.member's week credit on a row for the week after the
  // latest charged one, and leaves cancel.member a pending row there; running the seed again puts both members back.
  // The rows are written here as the run writes them, by SQL, so the seed's undo is tested without the run.
  it("AC11: after a week credit spent by hand and rows written after the latest charged week, a second run leaves one unspent week credit and no row after that week", async () => {
    const { subscriptionId, charged, latestPast } = await seeded();
    const after = addDays(charged.at(-1) ?? OCT_25, 7);
    const cancelSubscriptionId = (
      await pool.query<{ id: string }>("select s.id from subscriptions s join members m on m.id = s.member_id where m.email = 'cancel.member@example.com'")
    ).rows[0]?.id;
    const paidByCredit = (
      await pool.query<{ id: string }>(
        `insert into ledger (subscription_id, pickup_date, amount_cents, status, attempt, paid_at) values ($1, $2::date, 0, 'paid', 1, now()) returning id`,
        [subscriptionId, after],
      )
    ).rows[0]?.id;
    const spent = await pool.query("update week_credits set spent_on = $2 where subscription_id = $1 and spent_on is null", [subscriptionId, paidByCredit]);
    expect(spent.rowCount).toBe(1);
    await pool.query(`insert into ledger (subscription_id, pickup_date, amount_cents, status) values ($1, $2::date, 5000, 'pending')`, [cancelSubscriptionId, after]);

    await runSeed("account-weeks", url);

    const credits = (
      await pool.query<{ spent_on: string | null; granted_week: string }>(
        `select c.spent_on, to_char(l.pickup_date, 'YYYY-MM-DD') as granted_week
           from week_credits c join ledger l on l.id = c.granted_for
          where c.subscription_id = $1`,
        [subscriptionId],
      )
    ).rows;
    expect(credits).toEqual([{ spent_on: null, granted_week: latestPast }]);
    const later = (
      await pool.query<{ week: string }>(
        "select to_char(pickup_date, 'YYYY-MM-DD') as week from ledger where subscription_id = any($1::uuid[]) and pickup_date > $2::date",
        [[subscriptionId, cancelSubscriptionId], charged.at(-1)],
      )
    ).rows;
    expect(later).toEqual([]);
  });

  // Issue 139, AC15: the seed also makes cancel.member@example.com, the plain cancel to weeks.member's cancel with a
  // refund owed, and every run puts both back to active, so a cancel tried by hand is undone by running it again.
  describe("issue 139 — the two members a cancel is tried on", () => {
    const EMAILS = [EMAIL, "cancel.member@example.com"];

    /** Each of the two members' Supper Club subscriptions, by email: its status and cancelled_at. */
    const subscriptionsOf = async () =>
      (
        await pool.query<{ email: string; status: string; cancelled_at: Date | null }>(
          `select m.email, s.status, s.cancelled_at
             from subscriptions s
             join members m on m.id = s.member_id
             join products p on p.id = s.product_id
            where m.email = any($1) and p.name = 'Supper Club'
            order by m.email`,
          [EMAILS],
        )
      ).rows;

    it("AC15: a run leaves weeks.member@example.com and cancel.member@example.com each with one active subscription, cancelled_at null", async () => {
      await seeded();
      expect(await subscriptionsOf()).toEqual([
        { email: "cancel.member@example.com", status: "active", cancelled_at: null },
        { email: EMAIL, status: "active", cancelled_at: null },
      ]);
    });

    it("AC15: a run after both were cancelled puts both back to active, cancelled_at null", async () => {
      await seeded();
      await pool.query(
        `update subscriptions s set status = 'cancelled', cancelled_at = now()
           from members m where m.id = s.member_id and m.email = any($1)`,
        [EMAILS],
      );
      await runSeed("account-weeks", url);
      expect(await subscriptionsOf()).toEqual([
        { email: "cancel.member@example.com", status: "active", cancelled_at: null },
        { email: EMAIL, status: "active", cancelled_at: null },
      ]);
    });

    it("AC15: cancel.member@example.com holds no week credit, though the latest past week was closed after it was paid", async () => {
      const { latestPast } = await seeded();
      expect(latestPast).toBeDefined();
      const members = (await pool.query("select id from members where email = 'cancel.member@example.com'")).rows;
      expect(members).toHaveLength(1);
      const { rows } = await pool.query(
        `select c.id from week_credits c
           join subscriptions s on s.id = c.subscription_id
           join members m on m.id = s.member_id
          where m.email = 'cancel.member@example.com'`,
      );
      expect(rows).toEqual([]);
    });
  });

  // The seed reads the clock with `new Date()` and runs in this process (`runSeed`), so these fix it with Date-only
  // fake timers, as the page tests do, at instants chosen so the weeks fall out by hand. The Supper Club's cutoff is
  // the end of the Monday before each Sunday, and an ordinary week's last pickup day the Monday after it.
  describe("at a fixed clock", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** The weeks closed with a paid row still standing: closed after they were paid. */
    const closedAfterPaid = async (): Promise<string[]> =>
      (
        await pool.query<{ week: string }>(
          `select to_char(w.week_of, 'YYYY-MM-DD') as week
             from pickup_weeks w
             join ledger l on l.pickup_date = w.week_of and l.status = 'paid'
             join subscriptions s on s.id = l.subscription_id and s.product_id = w.product_id
             join members m on m.id = s.member_id
            where m.email = $1 and w.closed_at is not null
            order by w.week_of`,
          [EMAIL],
        )
      ).rows.map((row) => row.week);

    /** Every week credit the member's subscriptions hold, with the week of the ledger row each was granted for. */
    const creditsHeld = async () =>
      (
        await pool.query<{ spent_on: string | null; granted_week: string }>(
          `select c.spent_on, to_char(l.pickup_date, 'YYYY-MM-DD') as granted_week
             from week_credits c
             join ledger l on l.id = c.granted_for
             join subscriptions s on s.id = c.subscription_id
             join members m on m.id = s.member_id
            where m.email = $1
            order by l.pickup_date`,
          [EMAIL],
        )
      ).rows;

    it("AC11: a run a week after the last one leaves one week closed after it was paid, the new latest past week, and one unspent week credit, granted for it", async () => {
      // Wednesday, November 18, 2026, noon in Cleveland: the past weeks run through November 15 (last day the 16th).
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-18T17:00:00.000Z") });
      await runSeed("account-weeks", url);
      expect(await closedAfterPaid()).toEqual(["2026-11-15"]);

      // A week later, November 25: November 22 (last day the 23rd) is the latest past week now.
      vi.setSystemTime(new Date("2026-11-25T17:00:00.000Z"));
      await runSeed("account-weeks", url);
      expect(await closedAfterPaid()).toEqual(["2026-11-22"]);
      expect(await creditsHeld()).toEqual([{ spent_on: null, granted_week: "2026-11-22" }]);
    });

    it("AC11: the latest past week honours a stored move, as History's pastWeeks does: a week moved to end before today is past", async () => {
      // November 22's week moved, before its cutoff, to Saturday, November 21 only (`pickup_weeks`' first_day and
      // last_day, as the admin calendar or SQL stores it). On Sunday, November 22, noon in Cleveland, its last day
      // has passed, so it is History's newest row (`pastWeeks`); unmoved, its last day would be the 23rd.
      await runSeed("supper-club", url);
      const productId = (await pool.query<{ id: string }>("select id from products where name = 'Supper Club'")).rows[0]?.id;
      await pool.query("insert into pickup_weeks (product_id, week_of, first_day, last_day) values ($1, '2026-11-22', '2026-11-21', '2026-11-21')", [
        productId,
      ]);

      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-22T17:00:00.000Z") });
      await runSeed("account-weeks", url);
      expect(await closedAfterPaid()).toEqual(["2026-11-22"]);
      expect(await creditsHeld()).toEqual([{ spent_on: null, granted_week: "2026-11-22" }]);
    });
  });
});
