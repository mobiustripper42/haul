// `migrate` against a database of this suite's own, `<test db>_migrate`, dropped and recreated
// before every test, with migrations from a temporary directory — never db/migrations/.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/adapters/pg-connect.js";
import { requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { migrate } from "./migrate.js";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

const withDatabase = (database: string) => {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
};

const NAME = `${new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "")}_migrate`;
const MIGRATE_URL = withDatabase(NAME);

const query = async <R extends Record<string, unknown>>(url: string, sql: string): Promise<R[]> => {
  const client = createClient(url);
  await client.connect();
  try {
    return (await client.query<R>(sql)).rows;
  } finally {
    await client.end();
  }
};

const ledger = async () =>
  (await query<{ filename: string }>(MIGRATE_URL, "select filename from _migrations order by filename")).map(
    (r) => r.filename,
  );

const tables = async () =>
  (
    await query<{ tablename: string }>(
      MIGRATE_URL,
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations' order by tablename",
    )
  ).map((r) => r.tablename);

describe.skipIf(!up)(`AC5 — migrate${skipped}`, () => {
  let dir: string;

  beforeEach(async () => {
    const admin = withDatabase("postgres");
    await query(admin, `drop database if exists "${NAME}" with (force)`);
    await query(admin, `create database "${NAME}"`);
    dir = mkdtempSync(join(tmpdir(), "haul-migrate-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (filename: string, sql: string) => writeFileSync(join(dir, filename), sql);

  it("AC5: applies every .sql file in filename order, records each, and returns the filenames applied", async () => {
    // Written out of order, and the second depends on the first, so any other order fails.
    write("20260102000000_child.sql", "create table child (parent_id int not null references parent(id));");
    write("20260101000000_parent.sql", "create table parent (id int primary key);");
    write("20260103000000_other.sql", "create table other (id int);");
    write("notes.txt", "this is not sql and must not run");

    const applied = await migrate(MIGRATE_URL, dir);

    expect(applied).toEqual([
      "20260101000000_parent.sql",
      "20260102000000_child.sql",
      "20260103000000_other.sql",
    ]);
    expect(await ledger()).toEqual(applied);
    expect(await tables()).toEqual(["child", "other", "parent"]);
  });

  it("AC5: a second run applies nothing and returns []", async () => {
    write("20260101000000_parent.sql", "create table parent (id int primary key);");
    await migrate(MIGRATE_URL, dir);

    await expect(migrate(MIGRATE_URL, dir)).resolves.toEqual([]);
    expect(await ledger()).toEqual(["20260101000000_parent.sql"]);
  });

  it("AC5: a later run applies only the files not yet recorded", async () => {
    write("20260101000000_parent.sql", "create table parent (id int primary key);");
    await migrate(MIGRATE_URL, dir);
    write("20260102000000_child.sql", "create table child (parent_id int references parent(id));");

    await expect(migrate(MIGRATE_URL, dir)).resolves.toEqual(["20260102000000_child.sql"]);
    expect(await ledger()).toEqual(["20260101000000_parent.sql", "20260102000000_child.sql"]);
  });

  it("AC5: a failing migration rolls back, leaves no _migrations row for itself, and keeps the ones before it", async () => {
    write("20260101000000_good.sql", "create table good (id int);");
    write("20260102000000_bad.sql", "create table half_done (id int);\nselect 1 / 0;");

    await expect(migrate(MIGRATE_URL, dir)).rejects.toThrow();

    expect(await ledger()).toEqual(["20260101000000_good.sql"]);
    expect(await tables()).toEqual(["good"]);
  });
});
