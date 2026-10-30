// Issue 21 — the dev seeds. AC7–AC10 need no database. AC1–AC6 run every seed against a database
// of this suite's own, `<test db>_seed`, created if absent, migrated once, emptied before each test.
// Without a reachable Postgres those skip locally and fail in CI (DEC-014).
//
// `createClient` and `createPool` are wrapped in spies that call through, so the AC8/AC9 tests can
// make any connection attempt fail loudly and prove the rejection came before one.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, createPool } from "../src/adapters/pg-connect.js";
import type * as PgConnect from "../src/adapters/pg-connect.js";
import { ensureTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { migrate } from "./migrate.js";
import { assertLocalUrl, runSeed, SEEDS } from "./seed.js";

vi.mock("../src/adapters/pg-connect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PgConnect>();
  return { ...actual, createClient: vi.fn(actual.createClient), createPool: vi.fn(actual.createPool) };
});

const actual = await vi.importActual<typeof PgConnect>("../src/adapters/pg-connect.js");
const createClientSpy = vi.mocked(createClient);
const createPoolSpy = vi.mocked(createPool);

const root = fileURLToPath(new URL("..", import.meta.url));

// Nothing listens on port 1, so even a seed that wrongly connected could not write anywhere.
const LOCAL_URL = "postgres://haul:haul@localhost:1/haul_dev";

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

const LOCAL_URLS = [
  "postgres://haul:haul@localhost:5434/haul_dev",
  "postgres://haul:haul@127.0.0.1:5434/haul_dev",
  "postgres://haul:haul@[::1]:5434/haul_dev",
  "postgres://haul:haul@localhost:5434/haul_dev?application_name=seed",
];

/** Any attempt to open a connection throws, so a test sees it rather than a network wait. */
const forbidConnecting = () => {
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
};

const expectNoConnection = () => {
  expect(createClientSpy).not.toHaveBeenCalled();
  expect(createPoolSpy).not.toHaveBeenCalled();
};

describe("AC7 — every seed is named alike in package.json, SEEDS and db/seeds/", () => {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8")) as { scripts: Record<string, string> };
  const scripts = Object.keys(pkg.scripts)
    .map((key) => /^db:seed:(.+)$/.exec(key)?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
  const keys = Object.keys(SEEDS).sort();

  it("AC7: a db:seed:<name> script, a SEEDS key and a db/seeds/<name>.ts file name the same set", () => {
    const files = readdirSync(`${root}/db/seeds`)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .sort();
    const missing = (from: string[], others: string[][]) => from.filter((n) => !others.every((o) => o.includes(n)));
    expect({
      "only some sources name these scripts": missing(scripts, [keys, files]),
      "only some sources name these SEEDS keys": missing(keys, [scripts, files]),
      "only some sources name these db/seeds/ files": missing(files, [scripts, keys]),
    }).toEqual({
      "only some sources name these scripts": [],
      "only some sources name these SEEDS keys": [],
      "only some sources name these db/seeds/ files": [],
    });
  });

  it("AC7: the set is not empty, and holds members", () => {
    expect(keys).toContain("members");
  });

  it("AC7: each db:seed:<name> script runs `tsx db/seed.ts <name>`", () => {
    for (const name of scripts) {
      expect(pkg.scripts[`db:seed:${name}`], `db:seed:${name}`).toBe(`tsx db/seed.ts ${name}`);
    }
  });
});

describe("AC8 — runSeed with an unknown name", () => {
  forbidConnecting();

  it("AC8: rejects naming the unknown seed, without connecting", async () => {
    await expect(runSeed("no-such-seed", LOCAL_URL)).rejects.toThrow("no-such-seed");
    expectNoConnection();
  });
});

describe("AC9 — runSeed refuses a non-local URL before connecting", () => {
  forbidConnecting();

  it.each(NON_LOCAL_HOSTS)("AC9: assertLocalUrl throws naming the host %s", (host, url) => {
    expect(() => assertLocalUrl(url)).toThrow(host);
  });

  it.each(OVERRIDE_PARAMS)("AC9: assertLocalUrl throws naming the %s query parameter on a localhost URL", (_param, names, url) => {
    expect(() => assertLocalUrl(url)).toThrow(names);
  });

  it.each(NON_LOCAL_HOSTS)("AC9: runSeed('members') rejects naming the host %s, without connecting", async (host, url) => {
    await expect(runSeed("members", url)).rejects.toThrow(host);
    expectNoConnection();
  });

  it.each(OVERRIDE_PARAMS)(
    "AC9: runSeed('members') rejects naming the %s query parameter, without connecting",
    async (_param, names, url) => {
      await expect(runSeed("members", url)).rejects.toThrow(names);
      expectNoConnection();
    },
  );
});

describe("AC10 — assertLocalUrl accepts a local URL", () => {
  it.each(LOCAL_URLS)("AC10: accepts %s", (url) => {
    expect(() => assertLocalUrl(url)).not.toThrow();
  });
});

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC1–AC6 — the seeds against <test db>_seed${skipped}`, () => {
  let url: string;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    url = await ensureTestDatabase(TEST_DATABASE_URL, "seed");
    await migrate(url);
    pool = actual.createPool(url);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const publicTables = async (): Promise<string[]> =>
    (
      await pool.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public' order by tablename",
      )
    ).rows.map((r) => r.tablename);

  const dataTables = async (): Promise<string[]> => (await publicTables()).filter((t) => t !== "_migrations");

  /** Every public table but the migration ledger, emptied. */
  const empty = async (): Promise<void> => {
    const tables = await dataTables();
    if (tables.length === 0) return;
    await pool.query(`truncate ${tables.map((t) => `"${t}"`).join(", ")} restart identity cascade`);
  };

  /** Every public table's whole contents, each row as JSON, in a stable order. */
  const snapshot = async (): Promise<Record<string, unknown[]>> => {
    const out: Record<string, unknown[]> = {};
    for (const table of await publicTables()) {
      const { rows } = await pool.query<{ rows: unknown[] }>(
        `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as rows from "${table}" t`,
      );
      out[table] = rows[0]?.rows ?? [];
    }
    return out;
  };

  const names = Object.keys(SEEDS).sort();

  it("AC1: from an emptied database, members holds eric@ocf.xx and lenny@ocf.xx, both with language en", async () => {
    await empty();
    await runSeed("members", url);
    const { rows } = await pool.query<{ email: string; language: string }>(
      "select email, language from members order by email",
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { email: "eric@ocf.xx", language: "en" },
        { email: "lenny@ocf.xx", language: "en" },
      ]),
    );
  });

  it("AC2: with lenny's language edited to es, members puts it back to en and keeps lenny's id", async () => {
    await empty();
    await runSeed("members", url);
    const before = await pool.query<{ id: string }>("select id from members where email = 'lenny@ocf.xx'");
    expect(before.rows).toHaveLength(1);
    await pool.query("update members set language = 'es' where email = 'lenny@ocf.xx'");

    await runSeed("members", url);

    const after = await pool.query<{ id: string; language: string }>(
      "select id, language from members where email = 'lenny@ocf.xx'",
    );
    expect(after.rows).toEqual([{ id: before.rows[0]?.id, language: "en" }]);
  });

  // Issue 10. Roles are read through to_jsonb so a missing column reads as null rather than erroring.
  const roles = async (): Promise<Array<{ email: string; role: string | null }>> =>
    (
      await pool.query<{ email: string; role: string | null }>(
        "select email, to_jsonb(m) ->> 'role' as role from members m where email in ('eric@ocf.xx', 'lenny@ocf.xx') order by email",
      )
    ).rows;

  it("AC8 (issue 10): from an emptied database, members makes lenny@ocf.xx an admin and eric@ocf.xx a member", async () => {
    await empty();
    await runSeed("members", url);
    expect(await roles()).toEqual([
      { email: "eric@ocf.xx", role: "member" },
      { email: "lenny@ocf.xx", role: "admin" },
    ]);
  });

  it("AC8 (issue 10): with lenny's role edited to member, members puts back admin and keeps lenny's id", async () => {
    await empty();
    await runSeed("members", url);
    const lenny = async () =>
      (
        await pool.query<{ id: string; role: string | null }>(
          "select id, to_jsonb(m) ->> 'role' as role from members m where email = 'lenny@ocf.xx'",
        )
      ).rows;
    const before = await lenny();
    expect(before).toEqual([{ id: expect.any(String), role: "admin" }]);
    await pool.query("update members set role = 'member' where email = 'lenny@ocf.xx'");
    expect(await lenny()).toEqual([{ id: before[0]?.id, role: "member" }]);

    await runSeed("members", url);

    expect(await lenny()).toEqual([{ id: before[0]?.id, role: "admin" }]);
  });

  describe("AC3 — every seed runs alone", () => {
    it.each(names)("AC3: from an emptied database, %s succeeds and leaves a row in at least one table", async (name) => {
      await empty();
      await expect(runSeed(name, url)).resolves.toBeUndefined();
      const counts: Record<string, number> = {};
      for (const table of await dataTables()) {
        const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from "${table}"`);
        counts[table] = rows[0]?.n ?? 0;
      }
      expect(Object.values(counts).some((n) => n > 0), JSON.stringify(counts)).toBe(true);
    });
  });

  describe("AC4 — every seed runs twice", () => {
    it.each(names)("AC4: %s run again succeeds and leaves every table exactly as after the first run", async (name) => {
      await empty();
      await runSeed(name, url);
      const first = await snapshot();

      await expect(runSeed(name, url)).resolves.toBeUndefined();

      expect(await snapshot()).toEqual(first);
    });
  });

  it("AC5: every seed in name order, then every seed in reverse name order, both succeed and the second pass changes no table", async () => {
    await empty();
    for (const name of names) await runSeed(name, url);
    const first = await snapshot();

    for (const name of [...names].reverse()) await runSeed(name, url);

    expect(await snapshot()).toEqual(first);
  });

  it("AC6: a member no seed names (outsider@example.com, es) is unchanged in every column after every seed runs", async () => {
    await empty();
    await pool.query("insert into members (email, language) values ('outsider@example.com', 'es')");
    const row = async () =>
      (await pool.query<{ row: unknown }>("select to_jsonb(m) as row from members m where email = 'outsider@example.com'"))
        .rows;
    const before = await row();
    expect(before).toHaveLength(1);

    for (const name of names) await runSeed(name, url);

    expect(await row()).toEqual(before);
  });
});
