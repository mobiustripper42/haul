// Issue 133, AC6: the pickup_weeks table, with raw SQL as db/signup-tables.test.ts. Every test runs against a
// database of this suite's own, `<test db>_pickup_weeks`, created if absent, migrated once and emptied before
// each test. Without a reachable Postgres they skip locally and fail in CI (DEC-014). Each refusal is shown
// beside a row the table accepts, so a test can't pass on a table that refuses everything, or isn't there.
//
// The products: Box's cutoff is Monday at 24:00, so the week of Sunday 2027-01-03 has its cutoff on Monday
// 2026-12-28; Crate's is Friday at 18:00, so the same week's is on Friday 2027-01-01.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/adapters/pg-connect.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC6 (issue 133) — pickup_weeks in <test db>_pickup_weeks${skipped}`, () => {
  let pool: ReturnType<typeof createPool>;
  let box: string;
  let crate: string;

  beforeAll(async () => {
    pool = createPool(await migrateTestDatabase(TEST_DATABASE_URL, "pickup_weeks"));
  });

  afterAll(async () => {
    await pool?.end();
  });

  const product = async (name: string, cutoffWeekday: number, cutoffTime: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      "insert into products (name, cap, first_pickup_date, cutoff_weekday, cutoff_time) values ($1, 50, '2027-01-03', $2, $3) returning id",
      [name, cutoffWeekday, cutoffTime],
    );
    return rows[0]?.id ?? "no row";
  };

  beforeEach(async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
    );
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
    box = await product("Box", 1, "24:00");
    crate = await product("Crate", 5, "18:00");
  });

  type Row = { productId?: string; weekOf?: string; closedAt?: string | null; note?: string | null; firstDay?: string | null; lastDay?: string | null };

  /** A row; by default Box's week of January 3, closed with a note and no days. */
  const insert = (row: Row = {}) =>
    pool.query("insert into pickup_weeks (product_id, week_of, closed_at, note, first_day, last_day) values ($1, $2, $3, $4, $5, $6)", [
      row.productId ?? box,
      row.weekOf ?? "2027-01-03",
      row.closedAt === undefined ? "2026-11-01T12:00:00Z" : row.closedAt,
      row.note === undefined ? "Farm closed" : row.note,
      row.firstDay ?? null,
      row.lastDay ?? null,
    ]);

  /** Box's week of January 3, moved to `firstDay`..`lastDay` and open. */
  const movedTo = (firstDay: string | null, lastDay: string | null, over: Row = {}): Row => ({ closedAt: null, note: "Moved", firstDay, lastDay, ...over });

  const count = async (): Promise<number> => (await pool.query<{ n: number }>("select count(*)::int as n from pickup_weeks")).rows[0]?.n ?? -1;

  it("AC6: a closed week with a note and no days, a moved open week, and a row with no note are each accepted", async () => {
    await insert();
    await insert(movedTo("2027-01-09", "2027-01-10", { weekOf: "2027-01-10" }));
    await insert({ weekOf: "2027-01-17", note: null });
    expect(await count()).toBe(3);
  });

  it("AC6: a week_of that isn't a Sunday is refused", async () => {
    await insert({ weekOf: "2027-01-03" });
    await expect(insert({ weekOf: "2027-01-04" })).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(insert({ weekOf: "2027-01-09" })).rejects.toMatchObject({ code: CHECK_VIOLATION });
    expect(await count()).toBe(1);
  });

  it("AC6: a second row for the same product and week is refused; another product's, or another week, is not", async () => {
    await insert();
    await expect(insert({ note: "Again" })).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    await insert({ productId: crate });
    await insert({ weekOf: "2027-01-10" });
    expect(await count()).toBe(3);
  });

  it("AC6: first_day without last_day is refused, and last_day without first_day", async () => {
    await insert(movedTo("2027-01-02", "2027-01-03"));
    await expect(insert(movedTo("2027-01-09", null, { weekOf: "2027-01-10" }))).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(insert(movedTo(null, "2027-01-10", { weekOf: "2027-01-10" }))).rejects.toMatchObject({ code: CHECK_VIOLATION });
    expect(await count()).toBe(1);
  });

  it("AC6: a last_day before first_day is refused; a one-day move, first_day = last_day, is not", async () => {
    await insert(movedTo("2027-01-02", "2027-01-02"));
    await expect(insert(movedTo("2027-01-09", "2027-01-08", { weekOf: "2027-01-10" }))).rejects.toMatchObject({ code: CHECK_VIOLATION });
    expect(await count()).toBe(1);
  });

  it("AC6: a first_day on the date of the week's cutoff, or before it, is refused; the day after is accepted", async () => {
    await expect(insert(movedTo("2026-12-28", "2027-01-03"))).rejects.toThrow();
    await expect(insert(movedTo("2026-12-27", "2027-01-03"))).rejects.toThrow();
    await insert(movedTo("2026-12-29", "2027-01-03"));
    expect(await count()).toBe(1);
  });

  it("AC6: the cutoff is the product's own: for Crate's Friday cutoff, Friday January 1 is refused and Saturday January 2 accepted", async () => {
    await expect(insert(movedTo("2027-01-01", "2027-01-03", { productId: crate }))).rejects.toThrow();
    await insert(movedTo("2027-01-02", "2027-01-03", { productId: crate }));
    // Box's cutoff is Monday, so the same Friday is after it.
    await insert(movedTo("2027-01-01", "2027-01-03"));
    expect(await count()).toBe(2);
  });

  it("AC6: an update to a first_day on or before the cutoff's date is refused too, so an upsert can't slip one in", async () => {
    await insert(movedTo("2027-01-02", "2027-01-03"));
    await expect(
      pool.query("update pickup_weeks set first_day = '2026-12-28' where product_id = $1 and week_of = '2027-01-03'", [box]),
    ).rejects.toThrow();
    const { rows } = await pool.query("select to_char(first_day, 'YYYY-MM-DD') as first_day from pickup_weeks");
    expect(rows).toEqual([{ first_day: "2027-01-02" }]);
  });

  it.each([
    ["empty", ""],
    ["spaces only", "   "],
  ])("AC6: a blank note is refused: %s", async (_what, note) => {
    await insert({ note: "Farm closed" });
    await expect(insert({ weekOf: "2027-01-10", note })).rejects.toMatchObject({ code: CHECK_VIOLATION });
    expect(await count()).toBe(1);
  });

  it("AC6: it carries the audit trigger", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc p on p.oid = t.tgfoid
        where p.proname = 'audit_row' and not t.tgisinternal and c.relname = 'pickup_weeks'`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(["pickup_weeks"]);
  });
});
