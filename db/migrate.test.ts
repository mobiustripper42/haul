// `migrate` against a database of this suite's own, `<test db>_migrate`, dropped and recreated
// before every test, with migrations from a temporary directory — never db/migrations/.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/adapters/pg-connect.js";
import { requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { ChangedMigrationError, migrate } from "./migrate.js";

const root = fileURLToPath(new URL("..", import.meta.url));

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

// Issue 30: a checksum per applied file, and a refusal when one has changed or gone.
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const MESSAGE = (files: string[]) =>
  `Refusing to migrate: ${files.join(", ")} changed after being applied to this database. Rebuild a local database from empty with \`npm run db:rebuild:dev\`, then reseed.`;

describe.skipIf(!up)(`issue 30 — migrate records checksums and refuses changed files${skipped}`, () => {
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

  // Every column of every row, so "unchanged" covers applied_at as well as the checksum.
  const fullLedger = () => query(MIGRATE_URL, "select * from _migrations order by filename");

  const refusal = async (): Promise<unknown> => migrate(MIGRATE_URL, dir).then(() => "resolved", (e: unknown) => e);

  it("AC1: each applied file's row has checksum = lowercase hex SHA-256 of the file's bytes, unnormalized", async () => {
    // CRLF line endings, a trailing blank line and a non-ASCII byte: hashing anything but the bytes as read changes the sum.
    write("20260101000000_parent.sql", "-- café\r\ncreate table parent (id int primary key);\r\n\r\n");
    write("20260102000000_child.sql", "create table child (parent_id int references parent(id));\n");

    await migrate(MIGRATE_URL, dir);

    const rows = await query<{ filename: string; checksum: string | null }>(
      MIGRATE_URL,
      "select filename, checksum from _migrations order by filename",
    );
    expect(rows).toEqual([
      { filename: "20260101000000_parent.sql", checksum: sha256(readFileSync(join(dir, "20260101000000_parent.sql"))) },
      { filename: "20260102000000_child.sql", checksum: sha256(readFileSync(join(dir, "20260102000000_child.sql"))) },
    ]);
    for (const row of rows) expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  // The ledger as `migrate` made it before this task: no checksum column.
  const oldLedger = async (filenames: string[]) => {
    await query(
      MIGRATE_URL,
      "create table _migrations (filename text primary key, applied_at timestamptz not null default now())",
    );
    for (const f of filenames) await query(MIGRATE_URL, `insert into _migrations (filename) values ('${f}')`);
  };

  it("AC2: adds the checksum column to a ledger made before this task, and leaves the old rows' checksum null", async () => {
    write("20260101000000_parent.sql", "create table parent (id int primary key);");
    await query(MIGRATE_URL, "create table parent (id int primary key)");
    await oldLedger(["20260101000000_parent.sql"]);

    await migrate(MIGRATE_URL, dir).catch(() => undefined);

    const columns = await query<{ column_name: string; is_nullable: string; data_type: string }>(
      MIGRATE_URL,
      "select column_name, is_nullable, data_type from information_schema.columns where table_name = '_migrations' and column_name = 'checksum'",
    );
    expect(columns).toEqual([{ column_name: "checksum", is_nullable: "YES", data_type: "text" }]);
    expect(await query(MIGRATE_URL, "select filename, checksum from _migrations")).toEqual([
      { filename: "20260101000000_parent.sql", checksum: null },
    ]);
  });

  it("AC2: every row in a ledger made before this task counts as changed — refused, naming them, a pending file not applied", async () => {
    write("20260101000000_parent.sql", "create table parent (id int primary key);");
    write("20260102000000_other.sql", "create table other (id int primary key);");
    write("20260103000000_pending.sql", "create table pending (id int);");
    await query(MIGRATE_URL, "create table parent (id int primary key)");
    await query(MIGRATE_URL, "create table other (id int primary key)");
    await oldLedger(["20260101000000_parent.sql", "20260102000000_other.sql"]);

    const err = await refusal();

    expect(err).toBeInstanceOf(ChangedMigrationError);
    expect((err as ChangedMigrationError).files).toEqual(["20260101000000_parent.sql", "20260102000000_other.sql"]);
    expect(await ledger()).toEqual(["20260101000000_parent.sql", "20260102000000_other.sql"]);
    expect(await tables()).toEqual(["other", "parent"]);
  });

  it("AC3: an applied file whose bytes changed is refused with ChangedMigrationError naming it; nothing applied, ledger unchanged", async () => {
    write("20260101000000_parent.sql", "create table parent (id int primary key);");
    await migrate(MIGRATE_URL, dir);
    const before = await fullLedger();
    write("20260101000000_parent.sql", "create table parent (id int primary key, name text);");
    write("20260102000000_pending.sql", "create table pending (id int);");

    const err = await refusal();

    expect(err).toBeInstanceOf(ChangedMigrationError);
    expect((err as ChangedMigrationError).files).toEqual(["20260101000000_parent.sql"]);
    expect(await fullLedger()).toEqual(before);
    expect(await tables()).toEqual(["parent"]);
  });

  it("AC3: a change in line endings alone counts as changed", async () => {
    write("20260101000000_parent.sql", "create table parent (id int primary key);\n");
    await migrate(MIGRATE_URL, dir);
    write("20260101000000_parent.sql", "create table parent (id int primary key);\r\n");

    const err = await refusal();

    expect(err).toBeInstanceOf(ChangedMigrationError);
    expect((err as ChangedMigrationError).files).toEqual(["20260101000000_parent.sql"]);
  });

  it("AC4: a ledger row whose file is gone is refused the same way, naming it; nothing applied, ledger unchanged", async () => {
    write("20260101000000_parent.sql", "create table parent (id int primary key);");
    write("20260102000000_gone.sql", "create table gone (id int);");
    await migrate(MIGRATE_URL, dir);
    const before = await fullLedger();
    rmSync(join(dir, "20260102000000_gone.sql"));
    write("20260103000000_pending.sql", "create table pending (id int);");

    const err = await refusal();

    expect(err).toBeInstanceOf(ChangedMigrationError);
    expect((err as ChangedMigrationError).files).toEqual(["20260102000000_gone.sql"]);
    expect(await fullLedger()).toEqual(before);
    expect(await tables()).toEqual(["gone", "parent"]);
  });

  it("AC5: one refusal names every changed and missing file, in filename order", async () => {
    write("20260101000000_a.sql", "create table a (id int);");
    write("20260102000000_b.sql", "create table b (id int);");
    write("20260103000000_c.sql", "create table c (id int);");
    write("20260104000000_d.sql", "create table d (id int);");
    await migrate(MIGRATE_URL, dir);
    // Changed, missing, unchanged, changed: a check that collects changed files before missing ones gets the order wrong.
    write("20260101000000_a.sql", "create table a (id bigint);");
    rmSync(join(dir, "20260102000000_b.sql"));
    write("20260104000000_d.sql", "create table d (id bigint);");

    const err = await refusal();

    expect(err).toBeInstanceOf(ChangedMigrationError);
    expect((err as ChangedMigrationError).files).toEqual([
      "20260101000000_a.sql",
      "20260102000000_b.sql",
      "20260104000000_d.sql",
    ]);
  });

  it("AC5: the message names the files joined by \", \" and ends with the db:rebuild:dev instruction", async () => {
    write("20260101000000_a.sql", "create table a (id int);");
    write("20260102000000_b.sql", "create table b (id int);");
    await migrate(MIGRATE_URL, dir);
    write("20260101000000_a.sql", "create table a (id bigint);");
    rmSync(join(dir, "20260102000000_b.sql"));

    const err = await refusal();

    expect(err).toBeInstanceOf(ChangedMigrationError);
    expect((err as ChangedMigrationError).message).toBe(MESSAGE(["20260101000000_a.sql", "20260102000000_b.sql"]));
  });

  it("AC10: `npm run db:migrate -- <url>` with a ledger naming a file not in db/migrations/ prints the message alone on stderr and exits 1", async () => {
    write("20000101000000_gone.sql", "create table gone (id int);");
    await migrate(MIGRATE_URL, dir);

    const run = spawnSync("npm", ["run", "--silent", "db:migrate", "--", MIGRATE_URL], { cwd: root, encoding: "utf8" });

    expect(run.stderr.trim()).toBe(MESSAGE(["20000101000000_gone.sql"]));
    expect(run.status).toBe(1);
  });
});
