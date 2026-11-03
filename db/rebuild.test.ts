// `rebuildDatabase` against databases of this suite's own, `<test db>_rebuild` and
// `<test db>_rebuild_cli`, with migrations from a temporary directory — never db/migrations/ —
// except the CLI's success case, which rebuilds from db/migrations/ as `db:rebuild:dev` does.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/adapters/pg-connect.js";
import { requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { migrate } from "./migrate.js";
import { rebuildDatabase } from "./rebuild.js";
import { assertLocalUrl } from "./seed.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

const withDatabase = (database: string) => {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
};

const BASE = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
const NAME = `${BASE}_rebuild`;
const REBUILD_URL = withDatabase(NAME);
const CLI_URL = withDatabase(`${BASE}_rebuild_cli`);

// A host under .invalid never resolves (RFC 6761), so the only way to get assertLocalUrl's
// message rather than a DNS error is to refuse before connecting.
const REMOTE_URL = "postgres://haul:haul@db.example.invalid:5432/haul_dev";

const localRefusal = (url: string): string => {
  try {
    assertLocalUrl(url);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`assertLocalUrl accepted ${url}`);
};

const query = async <R extends Record<string, unknown>>(url: string, sql: string): Promise<R[]> => {
  const client = createClient(url);
  await client.connect();
  try {
    return (await client.query<R>(sql)).rows;
  } finally {
    await client.end();
  }
};

const tables = async (url: string) =>
  (
    await query<{ tablename: string }>(
      url,
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations' order by tablename",
    )
  ).map((r) => r.tablename);

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe.skipIf(!up)(`AC7 — rebuildDatabase${skipped}`, () => {
  let dir: string;
  let other: ReturnType<typeof createClient> | undefined;

  const write = (filename: string, sql: string) => writeFileSync(join(dir, filename), sql);

  // A database migrated from `dir`, then drifted: its first file changed since, a table no
  // migration makes, and a second connection left open on it.
  beforeEach(async () => {
    const admin = withDatabase("postgres");
    await query(admin, `drop database if exists "${NAME}" with (force)`);
    await query(admin, `create database "${NAME}"`);
    dir = mkdtempSync(join(tmpdir(), "haul-rebuild-"));

    // Written out of order, and the second depends on the first, so any other order fails.
    write("20260102000000_child.sql", "create table child (parent_id int references parent(id));");
    write("20260101000000_parent.sql", "create table parent (id int primary key);");
    await migrate(REBUILD_URL, dir);
    write("20260101000000_parent.sql", "create table parent (id int primary key, name text);");
    await query(REBUILD_URL, "create table extra (id int)");

    other = createClient(REBUILD_URL);
    // The rebuild terminates this connection; its error has nothing to report.
    other.on("error", () => {});
    await other.connect();
  });

  afterEach(async () => {
    await other?.end().catch(() => undefined);
    other = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it("AC7: returns the files applied, every file in dir, in filename order", async () => {
    await expect(rebuildDatabase(REBUILD_URL, dir)).resolves.toEqual([
      "20260101000000_parent.sql",
      "20260102000000_child.sql",
    ]);
  });

  it("AC7: the ledger matches dir, each row with the file's fresh checksum", async () => {
    await rebuildDatabase(REBUILD_URL, dir);

    expect(
      await query<{ filename: string; checksum: string | null }>(
        REBUILD_URL,
        "select filename, checksum from _migrations order by filename",
      ),
    ).toEqual([
      { filename: "20260101000000_parent.sql", checksum: sha256(join(dir, "20260101000000_parent.sql")) },
      { filename: "20260102000000_child.sql", checksum: sha256(join(dir, "20260102000000_child.sql")) },
    ]);
  });

  it("AC7: the database starts from empty: the extra table is gone and the changed file's new version is applied", async () => {
    await rebuildDatabase(REBUILD_URL, dir);

    expect(await tables(REBUILD_URL)).toEqual(["child", "parent"]);
    expect(
      (
        await query<{ column_name: string }>(
          REBUILD_URL,
          "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'parent' order by column_name",
        )
      ).map((r) => r.column_name),
    ).toEqual(["id", "name"]);
  });
});

describe("AC8 — rebuildDatabase refuses a non-local host", () => {
  it("AC8: throws assertLocalUrl's refusal for a host under .invalid, before any connection", async () => {
    await expect(rebuildDatabase(REMOTE_URL)).rejects.toThrow(localRefusal(REMOTE_URL));
  });
});

describe.skipIf(!up)(`AC11 — the db:rebuild:dev CLI${skipped}`, () => {
  it("AC11: rebuilds a local database from db/migrations/, prints `Rebuilt: applied <files>.` and exits 0", () => {
    const files = readdirSync(join(root, "db/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const run = spawnSync("npm", ["run", "--silent", "db:rebuild:dev", "--", CLI_URL], { cwd: root, encoding: "utf8" });

    expect(run.stdout.trim()).toBe(`Rebuilt: applied ${files.join(", ")}.`);
    expect(run.status).toBe(0);
  });
});

describe("AC11 — the db:rebuild:dev CLI refuses a non-local host", () => {
  it("AC11: prints assertLocalUrl's message alone on stderr and exits 1", () => {
    const run = spawnSync("npm", ["run", "--silent", "db:rebuild:dev", "--", REMOTE_URL], {
      cwd: root,
      encoding: "utf8",
    });

    expect(run.stderr.trim()).toBe(localRefusal(REMOTE_URL));
    expect(run.status).toBe(1);
  });
});
