// Issue 155, AC11: the `account-weeks` seed AC10's by-hand check starts from, in a database of this suite's own,
// `<test db>_account_weeks`, emptied before each test. The rules every seed keeps (alone, twice, stacked, only its
// own rows) run on it in db/seed.test.ts. Without a reachable Postgres these skip locally and fail in CI (DEC-014).
//
// The seed works its weeks out from now, so these do too, from the clock read just before it runs; a run that
// straddles a Monday's midnight cutoff would see one week differently. "Past" is AC6's: a week whose last pickup
// day has passed in Cleveland. Dates are read as text, so `pg` hands back what Postgres stores.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
});
