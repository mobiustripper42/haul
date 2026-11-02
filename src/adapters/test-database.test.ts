import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangedMigrationError, migrate } from "../../db/migrate.js";
import { createClient } from "./pg-connect.js";
import {
  ensureTestDatabase,
  migrateTestDatabase,
  requireTestDatabase,
  TEST_DATABASE_URL,
  testDatabaseUrl,
} from "./test-database.js";

// Port 1 on loopback refuses at once; 192.0.2.1 (TEST-NET-1, RFC 5737) never answers, so only
// the 2 s connect timeout ends the attempt.
const REFUSED = "postgres://haul:haul@127.0.0.1:1/haul_test";
const SILENT = "postgres://haul:haul@192.0.2.1:5432/haul_test";

describe("AC8 — requireTestDatabase", () => {
  it("AC8: returns false for an unreachable database when not in CI", async () => {
    await expect(requireTestDatabase(REFUSED, { ci: false })).resolves.toBe(false);
  });

  it("AC8: throws, naming `npm run db:up`, for an unreachable database in CI", async () => {
    await expect(requireTestDatabase(REFUSED, { ci: true })).rejects.toThrow(/npm run db:up/);
  });

  it("AC8: gives up after about 2 s on a host that never answers", async () => {
    const started = Date.now();
    await expect(requireTestDatabase(SILENT, { ci: false })).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(4000);
  }, 10_000);
});

describe("AC8 — TEST_DATABASE_URL, the one value every Postgres-backed suite uses", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const fresh = async () => (await import("./test-database.js")).TEST_DATABASE_URL;

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("AC8: defaults to haul_test on port 5434 when the variable is %s", async (_label, value) => {
    vi.stubEnv("TEST_DATABASE_URL", value);
    vi.resetModules();
    expect(await fresh()).toBe("postgres://haul:haul@localhost:5434/haul_test");
  });

  it("AC8: uses the variable when it is set", async () => {
    vi.stubEnv("TEST_DATABASE_URL", "postgres://haul:haul@localhost:5432/haul_test");
    vi.resetModules();
    expect(await fresh()).toBe("postgres://haul:haul@localhost:5432/haul_test");
  });
});

describe("AC4 (issue 31) — testDatabaseUrl, the naming ensureTestDatabase uses", () => {
  it("AC4: appends _<suffix> to the database name in the path", () => {
    expect(testDatabaseUrl("postgres://haul:haul@localhost:5434/haul_test", "e2e")).toBe(
      "postgres://haul:haul@localhost:5434/haul_test_e2e",
    );
  });

  it("AC4: keeps the query string", () => {
    expect(testDatabaseUrl("postgres://haul:haul@localhost:5432/haul_test?sslmode=disable", "e2e")).toBe(
      "postgres://haul:haul@localhost:5432/haul_test_e2e?sslmode=disable",
    );
  });
});

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC9 — ensureTestDatabase${skipped}`, () => {
  const base = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
  const name = `${base}_ensure`;

  const withClient = async <T>(url: string, fn: (client: ReturnType<typeof createClient>) => Promise<T>) => {
    const client = createClient(url);
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  };

  const adminUrl = () => {
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = "/postgres";
    return url.toString();
  };

  // The created-if-absent path runs every time.
  beforeEach(async () => {
    await withClient(adminUrl(), (c) => c.query(`drop database if exists "${name}" with (force)`));
  });

  it("AC9: creates <test db>_ensure when absent and returns its URL", async () => {
    const url = await ensureTestDatabase(TEST_DATABASE_URL, "ensure");

    const returned = new URL(url);
    const given = new URL(TEST_DATABASE_URL);
    expect(returned.pathname).toBe(`/${name}`);
    expect([returned.username, returned.password, returned.hostname, returned.port]).toEqual([
      given.username,
      given.password,
      given.hostname,
      given.port,
    ]);

    const { rows } = await withClient(url, (c) => c.query<{ db: string }>("select current_database() as db"));
    expect(rows[0]?.db).toBe(name);
  });

  it("AC9: only creates the database — it migrates nothing", async () => {
    const url = await ensureTestDatabase(TEST_DATABASE_URL, "ensure");
    const { rows } = await withClient(url, (c) =>
      c.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'"),
    );
    expect(rows).toEqual([]);
  });

  it("AC4 (issue 31): returns the URL testDatabaseUrl names for the same base and suffix", async () => {
    await expect(ensureTestDatabase(TEST_DATABASE_URL, "ensure")).resolves.toBe(testDatabaseUrl(TEST_DATABASE_URL, "ensure"));
  });

  it("AC9: a second call, with the database already there, returns the same URL without throwing", async () => {
    const first = await ensureTestDatabase(TEST_DATABASE_URL, "ensure");
    await expect(ensureTestDatabase(TEST_DATABASE_URL, "ensure")).resolves.toBe(first);
  });
});

describe.skipIf(!up)(`AC9 — migrateTestDatabase${skipped}`, () => {
  const base = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
  const name = `${base}_migrated`;
  let dir: string;

  const query = async <R extends Record<string, unknown>>(url: string, sql: string): Promise<R[]> => {
    const client = createClient(url);
    await client.connect();
    try {
      return (await client.query<R>(sql)).rows;
    } finally {
      await client.end();
    }
  };

  const adminUrl = () => {
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = "/postgres";
    return url.toString();
  };

  const tables = async (url: string) =>
    (
      await query<{ tablename: string }>(
        url,
        "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations' order by tablename",
      )
    ).map((r) => r.tablename);

  const ledger = async (url: string) =>
    (await query<{ filename: string }>(url, "select filename from _migrations order by filename")).map((r) => r.filename);

  const write = (filename: string, sql: string) => writeFileSync(join(dir, filename), sql);

  beforeEach(async () => {
    await query(adminUrl(), `drop database if exists "${name}" with (force)`);
    dir = mkdtempSync(join(tmpdir(), "haul-migrate-test-db-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("AC9: given no database, creates and migrates it and returns its URL", async () => {
    write("20260101000000_parent.sql", "create table parent (id int primary key);");

    const url = await migrateTestDatabase(TEST_DATABASE_URL, "migrated", dir);

    expect(url).toBe(testDatabaseUrl(TEST_DATABASE_URL, "migrated"));
    expect(await ledger(url)).toEqual(["20260101000000_parent.sql"]);
    expect(await tables(url)).toEqual(["parent"]);
  });

  it("AC9: given a database with a changed applied file, rebuilds it from empty and returns the same URL", async () => {
    const url = await ensureTestDatabase(TEST_DATABASE_URL, "migrated");
    write("20260101000000_parent.sql", "create table parent (id int primary key);");
    await migrate(url, dir);
    write("20260101000000_parent.sql", "create table parent (id int primary key, name text);");
    await query(url, "create table extra (id int)");

    await expect(migrateTestDatabase(TEST_DATABASE_URL, "migrated", dir)).resolves.toBe(url);

    expect(await tables(url)).toEqual(["parent"]);
    expect(
      (
        await query<{ column_name: string }>(
          url,
          "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'parent' order by column_name",
        )
      ).map((r) => r.column_name),
    ).toEqual(["id", "name"]);
    expect(await query(url, "select filename, checksum from _migrations")).toEqual([
      {
        filename: "20260101000000_parent.sql",
        checksum: createHash("sha256").update(readFileSync(join(dir, "20260101000000_parent.sql"))).digest("hex"),
      },
    ]);
  });

  it("AC9: given a migration that fails for any other reason, throws that error and rebuilds nothing", async () => {
    const url = await ensureTestDatabase(TEST_DATABASE_URL, "migrated");
    write("20260101000000_good.sql", "create table good (id int);");
    await migrate(url, dir);
    await query(url, "create table keep (id int)");
    write("20260102000000_bad.sql", "select 1 / 0;");

    const err = await migrateTestDatabase(TEST_DATABASE_URL, "migrated", dir).then(
      () => "resolved",
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/division by zero/);
    expect(err).not.toBeInstanceOf(ChangedMigrationError);
    expect(await tables(url)).toEqual(["good", "keep"]);
    expect(await ledger(url)).toEqual(["20260101000000_good.sql"]);
  });
});
