// Issue 55, AC1: findProductByName against real Postgres, in a database of its own: `<test db>_product`,
// created if absent, migrated once, emptied before each test. Without a reachable Postgres it skips
// locally and fails in CI (DEC-014).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../db/seed.js";
import { SUPPER_CLUB_PRODUCT_NAME, type ProductInput, type ProductWithOptions } from "../products.js";
import { createPool } from "./pg-connect.js";
import { PostgresRepository } from "./postgres-repository.js";
import { runProductContract } from "./product-contract.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "./test-database.js";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC1 — findProductByName in <test db>_product${skipped}`, () => {
  let url: string;
  let pool: ReturnType<typeof createPool>;
  let repo: PostgresRepository;

  beforeAll(async () => {
    url = await migrateTestDatabase(TEST_DATABASE_URL, "product");
    pool = createPool(url);
    repo = new PostgresRepository(url);
  });

  afterAll(async () => {
    await repo?.close();
    await pool?.end();
  });

  const truncateAll = async (): Promise<void> => {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
    );
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  };

  /** Inserts the rows, in the order given, and reads the product back. */
  const addProduct = async (input: ProductInput): Promise<ProductWithOptions> => {
    const product = await pool.query<{ id: string }>(
      `insert into products (name, cap, first_pickup_date, cutoff_weekday, cutoff_time)
       values ($1, $2, $3, $4, $5) returning id`,
      [input.name, input.cap, input.firstPickupDate, input.cutoffWeekday, input.cutoffTime],
    );
    for (const type of input.optionTypes) {
      const row = await pool.query<{ id: string }>(
        "insert into option_types (product_id, name, position) values ($1, $2, $3) returning id",
        [product.rows[0]?.id, type.name, type.position],
      );
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

  runProductContract("postgres", async () => repo, addProduct, truncateAll);

  it("AC1: the supper-club seed's product is found by SUPPER_CLUB_PRODUCT_NAME, its pickers in the seed's order", async () => {
    await truncateAll();
    await runSeed("supper-club", url);

    const found = await repo.findProductByName(SUPPER_CLUB_PRODUCT_NAME);
    expect(found).toMatchObject({ name: "Supper Club", cap: 50, firstPickupDate: "2027-01-03", cutoffWeekday: 1, cutoffTime: "24:00:00" });
    expect(found?.optionTypes.map((type) => [type.name, type.options.map((option) => [option.name, option.priceCents])])).toEqual([
      ["Size", [["2 person", 5000], ["3–4 person", 8000]]],
      ["Preference", [["Standard", 0], ["Vegan", 0]]],
    ]);
  });
});
