// Issue #53 — the products, option_types and options tables, AC6–AC10. Every test runs against a
// database of this suite's own, `<test db>_products`, created if absent and migrated once with every
// file in db/migrations/. Without a reachable Postgres they skip locally and fail in CI (DEC-014).
//
// AC6–AC9 work inside a transaction that is always rolled back, so nothing they insert outlives the
// test; each attempt sits in a savepoint of its own, rolled back after it, so one attempt's row or
// error never shapes the next. A refusal is asserted by its SQLSTATE, so a table or column that does
// not exist (42P01, 42703) is never mistaken for one. AC10 commits: it empties every table, then runs
// the seed as `npm run db:seed:supper-club` does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "../src/adapters/pg-connect.js";
import type { Client } from "../src/adapters/pg-connect.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { runSeed } from "./seed.js";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC6–AC10 — products, option_types and options against <test db>_products${skipped}`, () => {
  let url: string;
  let db: Client;

  beforeAll(async () => {
    url = await migrateTestDatabase(TEST_DATABASE_URL, "products");
    db = createClient(url);
    await db.connect();
  });

  afterAll(async () => {
    await db?.end();
  });

  /** Runs `body` inside a transaction that is always rolled back. */
  const rolledBack = async (body: () => Promise<void>): Promise<void> => {
    await db.query("begin");
    try {
      await body();
    } finally {
      await db.query("rollback");
    }
  };

  /** Runs one statement in a savepoint, always rolled back to; returns the error's SQLSTATE, or "ok". */
  const attempt = async (sql: string, params: unknown[] = []): Promise<string> => {
    await db.query("savepoint attempt");
    try {
      await db.query(sql, params);
      return "ok";
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    } finally {
      await db.query("rollback to savepoint attempt");
    }
  };

  type Product = { name: string; cap: number; cutoff_weekday: number };
  const PRODUCT: Product = { name: "Probe Box", cap: 5, cutoff_weekday: 3 };

  const insertProductSql =
    "insert into products (name, cap, first_pickup_date, cutoff_weekday, cutoff_time) values ($1, $2, '2027-02-07', $3, '12:00')";
  const productParams = (p: Partial<Product> = {}) => {
    const { name, cap, cutoff_weekday } = { ...PRODUCT, ...p };
    return [name, cap, cutoff_weekday];
  };

  /** A product committed to the open transaction; returns its id. */
  const product = async (name = PRODUCT.name): Promise<string> => {
    const { rows } = await db.query<{ id: string }>(`${insertProductSql} returning id`, productParams({ name }));
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("insert returned no id");
    return id;
  };

  /** An option type committed to the open transaction; returns its id. */
  const optionType = async (productId: string, name = "Probe Type"): Promise<string> => {
    const { rows } = await db.query<{ id: string }>(
      "insert into option_types (product_id, name, position) values ($1, $2, 1) returning id",
      [productId, name],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("insert returned no id");
    return id;
  };

  const insertOptionSql = "insert into options (option_type_id, name, price_cents, position) values ($1, $2, $3, 1)";

  describe("AC6 — price, cap and cutoff weekday", () => {
    it("AC6: refuses an option priced at -1 cents with a check violation, and accepts one priced at 0", async () => {
      await rolledBack(async () => {
        const type = await optionType(await product());
        expect(await attempt(insertOptionSql, [type, "Probe Option", -1])).toBe(CHECK_VIOLATION);
        expect(await attempt(insertOptionSql, [type, "Probe Option", 0])).toBe("ok");
      });
    });

    it("AC6: refuses a product with cap 0 with a check violation, and accepts cap 1", async () => {
      await rolledBack(async () => {
        expect(await attempt(insertProductSql, productParams({ cap: 0 }))).toBe(CHECK_VIOLATION);
        expect(await attempt(insertProductSql, productParams({ cap: 1 }))).toBe("ok");
      });
    });

    it.each([0, 8])("AC6: refuses a product with cutoff_weekday %i with a check violation", async (weekday) => {
      await rolledBack(async () => {
        expect(await attempt(insertProductSql, productParams({ cutoff_weekday: weekday }))).toBe(CHECK_VIOLATION);
      });
    });

    it.each([1, 7])("AC6: accepts a product with cutoff_weekday %i", async (weekday) => {
      await rolledBack(async () => {
        expect(await attempt(insertProductSql, productParams({ cutoff_weekday: weekday }))).toBe("ok");
      });
    });
  });

  describe("AC7 — a blank name", () => {
    const BLANKS: Array<[string, string]> = [
      ["''", ""],
      ["'   '", "   "],
    ];

    it.each(BLANKS)("AC7: products refuses the name %s with a check violation", async (_shown, blank) => {
      await rolledBack(async () => {
        expect(await attempt(insertProductSql, productParams({ name: blank }))).toBe(CHECK_VIOLATION);
      });
    });

    it.each(BLANKS)("AC7: option_types refuses the name %s with a check violation", async (_shown, blank) => {
      await rolledBack(async () => {
        const productId = await product();
        expect(
          await attempt("insert into option_types (product_id, name, position) values ($1, $2, 1)", [productId, blank]),
        ).toBe(CHECK_VIOLATION);
      });
    });

    it.each(BLANKS)("AC7: options refuses the name %s with a check violation", async (_shown, blank) => {
      await rolledBack(async () => {
        const type = await optionType(await product());
        expect(await attempt(insertOptionSql, [type, blank, 0])).toBe(CHECK_VIOLATION);
      });
    });

    it("AC7: the name column of each of the three tables is of the one nonblank_text domain", async () => {
      const { rows } = await db.query<{ table_name: string; domain_name: string | null }>(
        `select table_name, domain_name from information_schema.columns
          where table_schema = 'public' and column_name = 'name'
            and table_name in ('products', 'option_types', 'options')
          order by table_name`,
      );
      expect(rows).toEqual([
        { table_name: "option_types", domain_name: "nonblank_text" },
        { table_name: "options", domain_name: "nonblank_text" },
        { table_name: "products", domain_name: "nonblank_text" },
      ]);
    });
  });

  describe("AC8 — names unique under their parent", () => {
    it("AC8: refuses a second product with the same name with a unique violation", async () => {
      await rolledBack(async () => {
        await product("Probe Box");
        expect(await attempt(insertProductSql, productParams({ name: "Probe Box" }))).toBe(UNIQUE_VIOLATION);
      });
    });

    it("AC8: refuses a second option type with the same name in one product, and accepts that name in another product", async () => {
      await rolledBack(async () => {
        const first = await product("Probe Box");
        const second = await product("Probe Crate");
        await optionType(first, "Size");
        const sql = "insert into option_types (product_id, name, position) values ($1, 'Size', 2)";
        expect(await attempt(sql, [first])).toBe(UNIQUE_VIOLATION);
        expect(await attempt(sql, [second])).toBe("ok");
      });
    });

    it("AC8: refuses a second option with the same name in one option type, and accepts that name in another option type", async () => {
      await rolledBack(async () => {
        const productId = await product();
        const size = await optionType(productId, "Size");
        const preference = await optionType(productId, "Preference");
        await db.query(insertOptionSql, [size, "Standard", 0]);
        expect(await attempt(insertOptionSql, [size, "Standard", 0])).toBe(UNIQUE_VIOLATION);
        expect(await attempt(insertOptionSql, [preference, "Standard", 0])).toBe("ok");
      });
    });
  });

  describe("AC9 — a parent with children is not deleted", () => {
    it("AC9: refuses deleting a product that has an option type, with a foreign key violation", async () => {
      await rolledBack(async () => {
        const productId = await product();
        await optionType(productId);
        expect(await attempt("delete from products where id = $1", [productId])).toBe(FOREIGN_KEY_VIOLATION);
      });
    });

    it("AC9: refuses deleting an option type that has an option, with a foreign key violation", async () => {
      await rolledBack(async () => {
        const type = await optionType(await product());
        await db.query(insertOptionSql, [type, "Probe Option", 0]);
        expect(await attempt("delete from option_types where id = $1", [type])).toBe(FOREIGN_KEY_VIOLATION);
      });
    });
  });

  it("AC10: from an emptied database, the seed's first run writes one insert row to audit_log for each row it makes in the three tables", async () => {
    const { rows: tables } = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
    );
    await db.query(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);

    await runSeed("supper-club", url);

    for (const table of ["products", "option_types", "options"]) {
      // Sorted here rather than in SQL, where uuid and text order can differ.
      const made = (await db.query<{ id: string }>(`select id::text as id from "${table}"`)).rows.map((r) => r.id).sort();
      const audited = (
        await db.query<{ id: string }>(
          "select row_key ->> 'id' as id from audit_log where table_name = $1 and operation = 'insert'",
          [table],
        )
      ).rows
        .map((r) => r.id)
        .sort();
      expect(made.length, `${table} holds a row after the seed`).toBeGreaterThan(0);
      expect(audited, table).toEqual(made);
    }
  });
});
