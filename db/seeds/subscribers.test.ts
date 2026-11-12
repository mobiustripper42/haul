// Issue 59's Seeds section: what AC12's by-hand check and e2e/admin-members.spec.ts start from, in a
// database of this suite's own, `<test db>_subscribers`, emptied before each test. The rules every seed
// keeps (alone, twice, stacked, only its own rows) run on it in db/seed.test.ts. Without a reachable
// Postgres these skip locally and fail in CI (DEC-014).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../../src/adapters/pg-connect.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../../src/adapters/test-database.js";
import { runSeed } from "../seed.js";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC12's seed — subscribers against <test db>_subscribers${skipped}`, () => {
  let url: string;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    url = await migrateTestDatabase(TEST_DATABASE_URL, "subscribers");
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

  /** Each Supper Club subscription with what it needs to be a row on the list. */
  const subscriptions = async () =>
    (
      await pool.query<{ email: string; status: string; square_customer_id: string | null; paid: number; meal: string | null }>(
        `select m.email, s.status, m.square_customer_id,
                (select count(*)::int from ledger l where l.subscription_id = s.id and l.status = 'paid' and l.paid_at is not null) as paid,
                (select string_agg(o.name, ' · ' order by t.position)
                   from subscription_options so
                   join option_types t on t.id = so.option_type_id
                   join options o on o.id = so.option_id
                  where so.subscription_id = s.id) as meal
           from subscriptions s
           join members m on m.id = s.member_id
           join products p on p.id = s.product_id
          where p.name = 'Supper Club'`,
      )
    ).rows;

  it("AC12 (seed): from an emptied database, 12 members each hold one active Supper Club subscription with a paid ledger row", async () => {
    await runSeed("subscribers", url);

    const rows = await subscriptions();

    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((row) => row.email)).size).toBe(12);
    for (const row of rows) expect(row, row.email).toMatchObject({ status: "active", paid: 1 });
  });

  it("AC12 (seed), AC5 (issue 102): the rows cover all four option mixes, in the new size names", async () => {
    await runSeed("subscribers", url);

    expect([...new Set((await subscriptions()).map((row) => row.meal))].sort()).toEqual([
      "Portioned for 2 · Standard",
      "Portioned for 2 · Vegan",
      "Portioned for 4 · Standard",
      "Portioned for 4 · Vegan",
    ]);
  });

  it("AC5 (issue 102): every member's first pickup is 2026-10-25", async () => {
    await runSeed("subscribers", url);

    const { rows } = await pool.query<{ pickup_date: string }>(
      `select l.pickup_date::text as pickup_date
         from ledger l
         join subscriptions s on s.id = l.subscription_id
         join products p on p.id = s.product_id
        where p.name = 'Supper Club'`,
    );
    expect(rows).toHaveLength(12);
    expect([...new Set(rows.map((row) => row.pickup_date))]).toEqual(["2026-10-25"]);
  });

  it("AC4 (issue 138): every subscription's picks start from its first ledger week, 2026-10-25", async () => {
    await runSeed("subscribers", url);

    const { rows } = await pool.query<{ from_week: string; picks: number }>(
      `select to_char(so.from_week, 'YYYY-MM-DD') as from_week, count(*)::int as picks
         from subscription_options so
         join subscriptions s on s.id = so.subscription_id
         join products p on p.id = s.product_id
        where p.name = 'Supper Club'
        group by so.from_week`,
    );
    expect(rows).toEqual([{ from_week: "2026-10-25", picks: 24 }]);
  });

  it("AC12 (seed): none of the members has a Square customer", async () => {
    await runSeed("subscribers", url);

    const rows = await subscriptions();

    expect(rows).toHaveLength(12);
    expect(rows.filter((row) => row.square_customer_id !== null)).toEqual([]);
  });
});
