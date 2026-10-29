// Issue 21 — `resetDev`. AC9 needs no database. AC11 runs against a database of this suite's own,
// `<test db>_reset`, created if absent and migrated once. Without a reachable Postgres it skips
// locally and fails in CI (DEC-014).
//
// `createClient` and `createPool` are wrapped in spies that call through, so the AC9 tests can make
// any connection attempt fail loudly and prove the rejection came before one.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, createPool } from "../src/adapters/pg-connect.js";
import type * as PgConnect from "../src/adapters/pg-connect.js";
import { ensureTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { migrate } from "./migrate.js";
import { resetDev } from "./reset-dev.js";
import { runSeed } from "./seed.js";

vi.mock("../src/adapters/pg-connect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PgConnect>();
  return { ...actual, createClient: vi.fn(actual.createClient), createPool: vi.fn(actual.createPool) };
});

const actual = await vi.importActual<typeof PgConnect>("../src/adapters/pg-connect.js");
const createClientSpy = vi.mocked(createClient);
const createPoolSpy = vi.mocked(createPool);

const NON_LOCAL_HOSTS: Array<[string, string]> = [
  ["db.example.invalid", "postgres://haul:haul@db.example.invalid:5432/haul_dev"],
  ["127.0.0.2", "postgres://haul:haul@127.0.0.2:5434/haul_dev"],
  ["192.0.2.10", "postgres://haul:haul@192.0.2.10:5432/haul_dev"],
  ["localhost.example.invalid", "postgres://haul:haul@localhost.example.invalid:5432/haul_dev"],
];

const OVERRIDE_PARAMS: Array<[string, RegExp, string]> = [
  ["host", /\bhost\b/, "postgres://haul:haul@localhost:5434/haul_dev?host=db.example.invalid"],
  ["hostaddr", /hostaddr/, "postgres://haul:haul@localhost:5434/haul_dev?hostaddr=192.0.2.10"],
];

describe("AC9 — resetDev refuses a non-local URL before connecting", () => {
  beforeEach(() => {
    createClientSpy.mockClear();
    createPoolSpy.mockClear();
    createClientSpy.mockImplementation(() => {
      throw new Error("createClient was called");
    });
    createPoolSpy.mockImplementation(() => {
      throw new Error("createPool was called");
    });
  });
  afterEach(() => {
    createClientSpy.mockImplementation(actual.createClient);
    createPoolSpy.mockImplementation(actual.createPool);
  });

  it.each(NON_LOCAL_HOSTS)("AC9: resetDev rejects naming the host %s, without connecting", async (host, url) => {
    await expect(resetDev(url)).rejects.toThrow(host);
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(createPoolSpy).not.toHaveBeenCalled();
  });

  it.each(OVERRIDE_PARAMS)(
    "AC9: resetDev rejects naming the %s query parameter, without connecting",
    async (_param, names, url) => {
      await expect(resetDev(url)).rejects.toThrow(names);
      expect(createClientSpy).not.toHaveBeenCalled();
      expect(createPoolSpy).not.toHaveBeenCalled();
    },
  );
});

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC11 — resetDev against <test db>_reset${skipped}`, () => {
  let url: string;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    url = await ensureTestDatabase(TEST_DATABASE_URL, "reset");
    await migrate(url);
    pool = actual.createPool(url);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const count = async (table: string): Promise<number> =>
    (await pool.query<{ n: number }>(`select count(*)::int as n from "${table}"`)).rows[0]?.n ?? 0;

  const ledger = async () =>
    (await pool.query<{ filename: string; applied_at: Date }>("select * from _migrations order by filename")).rows;

  it("AC11: on a seeded database, every public table but _migrations ends empty and _migrations keeps all its rows", async () => {
    await runSeed("members", url);
    // A table no migration names: resetDev must list tables from the catalog, not from a fixed list.
    await pool.query("create table if not exists reset_probe (id int)");
    await pool.query("insert into reset_probe (id) values (1)");
    const ledgerBefore = await ledger();
    expect(ledgerBefore.length).toBeGreaterThan(0);
    expect(await count("members")).toBeGreaterThan(0);

    await resetDev(url);

    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations' order by tablename",
    );
    const counts: Record<string, number> = {};
    for (const { tablename } of rows) counts[tablename] = await count(tablename);
    expect(counts).toEqual(Object.fromEntries(rows.map((r) => [r.tablename, 0])));
    expect(counts).toHaveProperty("reset_probe", 0);
    expect(await ledger()).toEqual(ledgerBefore);
  });
});
