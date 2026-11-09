// Issue #53 — the `supper-club` seed, AC1–AC4; issue 77, AC14, renames its option types and sizes. Every test runs against a database of this suite's
// own, `<test db>_supper_club`, created if absent, migrated once, and emptied (every table but the
// migration ledger) before each test. Without a reachable Postgres they skip locally and fail in CI
// (DEC-014). The seed is run as `npm run db:seed:supper-club` runs it, through `runSeed`.
//
// Dates and times are read as text, so `pg` hands back what Postgres stores rather than a JS Date.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../../src/adapters/pg-connect.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../../src/adapters/test-database.js";
import { runSeed } from "../seed.js";

const EN_DASH = "–";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC1–AC4 — the supper-club seed against <test db>_supper_club${skipped}`, () => {
  let url: string;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    url = await migrateTestDatabase(TEST_DATABASE_URL, "supper_club");
    pool = createPool(url);
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** Every public table but the migration ledger, emptied. */
  beforeEach(async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
    );
    if (rows.length === 0) return;
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  });

  const seed = () => runSeed("supper-club", url);

  /** The Supper Club's product row, settings as text. */
  const supperClub = async () =>
    (
      await pool.query<{
        id: string;
        name: string;
        cap: number;
        first_pickup_date: string;
        cutoff_weekday: number;
        cutoff_time: string;
      }>(
        `select id, name, cap, first_pickup_date::text as first_pickup_date, cutoff_weekday, cutoff_time::text as cutoff_time
           from products where name = 'Supper Club'`,
      )
    ).rows;

  /** One of the Supper Club's option types' options, in position order. */
  const optionsOf = async (typeName: string) =>
    (
      await pool.query<{ id: string; name: string; price_cents: number; position: number }>(
        `select o.id, o.name, o.price_cents, o.position
           from options o
           join option_types t on t.id = o.option_type_id
           join products p on p.id = t.product_id
          where p.name = 'Supper Club' and t.name = $1
          order by o.position, o.name`,
        [typeName],
      )
    ).rows;

  it("AC1: from an emptied database, products holds Supper Club with cap 50, first pickup 2027-01-03, cutoff Monday (1) at 24:00:00", async () => {
    await seed();

    expect(await supperClub()).toEqual([
      {
        id: expect.any(String),
        name: "Supper Club",
        cap: 50,
        first_pickup_date: "2027-01-03",
        cutoff_weekday: 1,
        cutoff_time: "24:00:00",
      },
    ]);
  });

  describe("AC2 — the option types and options", () => {
    it('AC14 (issue 77): the Supper Club\'s option types by position are "How many people?" then "Which menu?", at distinct positions', async () => {
      await seed();

      const { rows } = await pool.query<{ name: string; position: number }>(
        `select t.name, t.position
           from option_types t join products p on p.id = t.product_id
          where p.name = 'Supper Club'
          order by t.position, t.name`,
      );
      expect(rows.map((r) => r.name)).toEqual(["How many people", "Which menu"]);
      expect(new Set(rows.map((r) => r.position)).size).toBe(rows.length);
    });

    it(`AC14: "How many people?" has, by position, 3${EN_DASH}4 people (an en dash) at 8000 cents then 2 people at 5000, at distinct positions`, async () => {
      await seed();

      const rows = await optionsOf("How many people");
      expect(rows.map(({ name, price_cents }) => ({ name, price_cents }))).toEqual([
        { name: `3${EN_DASH}4 people`, price_cents: 8000 },
        { name: "2 people", price_cents: 5000 },
      ]);
      expect(new Set(rows.map((r) => r.position)).size).toBe(rows.length);
    });

    it('AC14 (issue 77): "Which menu?" has, by position, Standard then Vegan, both at 0 cents, at distinct positions', async () => {
      await seed();

      const rows = await optionsOf("Which menu");
      expect(rows.map(({ name, price_cents }) => ({ name, price_cents }))).toEqual([
        { name: "Standard", price_cents: 0 },
        { name: "Vegan", price_cents: 0 },
      ]);
      expect(new Set(rows.map((r) => r.position)).size).toBe(rows.length);
    });
  });

  it("AC3: with cap edited to 10 and 2 people to 5500 cents at position 9, a re-run puts back cap 50, 5000 and position 2, and keeps both ids", async () => {
    await seed();
    const [product] = await supperClub();
    const [twoPerson] = (await optionsOf("How many people")).filter((o) => o.name === "2 people");
    expect(product).toBeDefined();
    expect(twoPerson).toBeDefined();

    await pool.query("update products set cap = 10 where name = 'Supper Club'");
    await pool.query("update options set price_cents = 5500, position = 9 where id = $1", [twoPerson?.id]);
    expect((await supperClub())[0]?.cap).toBe(10);
    expect((await optionsOf("How many people")).find((o) => o.name === "2 people")).toMatchObject({ price_cents: 5500, position: 9 });

    await seed();

    expect(await supperClub()).toEqual([expect.objectContaining({ id: product?.id, cap: 50 })]);
    expect((await optionsOf("How many people")).filter((o) => o.name === "2 people")).toEqual([
      { id: twoPerson?.id, name: "2 people", price_cents: 5000, position: 2 },
    ]);
  });

  it('AC4: a product the seed doesn\'t name (Test Box, its option type and option) and Spicy under "Which menu?" are unchanged in every column after a re-run', async () => {
    await seed();

    const box = await pool.query<{ id: string }>(
      `insert into products (name, cap, first_pickup_date, cutoff_weekday, cutoff_time)
       values ('Test Box', 7, '2027-02-07', 3, '12:00') returning id`,
    );
    const boxType = await pool.query<{ id: string }>(
      "insert into option_types (product_id, name, position) values ($1, 'Box Size', 1) returning id",
      [box.rows[0]?.id],
    );
    const boxOption = await pool.query<{ id: string }>(
      "insert into options (option_type_id, name, price_cents, position) values ($1, 'Large', 1200, 1) returning id",
      [boxType.rows[0]?.id],
    );
    const spicy = await pool.query<{ id: string }>(
      `insert into options (option_type_id, name, price_cents, position)
       select t.id, 'Spicy', 0, 3
         from option_types t join products p on p.id = t.product_id
        where p.name = 'Supper Club' and t.name = 'Which menu'
       returning id`,
    );
    expect(spicy.rows).toHaveLength(1);

    const rows = async () => ({
      testBox: (await pool.query("select to_jsonb(r) as row from products r where id = $1", [box.rows[0]?.id])).rows,
      boxType: (await pool.query("select to_jsonb(r) as row from option_types r where id = $1", [boxType.rows[0]?.id]))
        .rows,
      boxOption: (await pool.query("select to_jsonb(r) as row from options r where id = $1", [boxOption.rows[0]?.id]))
        .rows,
      spicy: (await pool.query("select to_jsonb(r) as row from options r where id = $1", [spicy.rows[0]?.id])).rows,
    });
    const before = await rows();
    for (const [which, found] of Object.entries(before)) expect(found, which).toHaveLength(1);

    await seed();

    expect(await rows()).toEqual(before);
  });

  // Issue 101, AC6: the names are data, in the farm's words; the picker's question mark is the catalog's (DEC-027).
  it("AC6 (issue 101): the seed stores the option types as \"How many people\" and \"Which menu\", neither with a question mark", async () => {
    await seed();

    const { rows } = await pool.query<{ name: string }>(
      `select t.name
         from option_types t join products p on p.id = t.product_id
        where p.name = 'Supper Club'
        order by t.position, t.name`,
    );
    expect(rows.map((r) => r.name)).toEqual(["How many people", "Which menu"]);
  });
});
