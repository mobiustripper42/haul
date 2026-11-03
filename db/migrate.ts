/**
 * Migration runner (DEC-013). Applies db/migrations/*.sql in filename order, each in its own
 * transaction, tracked in `_migrations` so a re-run is a no-op. Plain SQL, forward only.
 *
 * Used two ways: the `db:migrate` CLI, and the Postgres suites, which call `migrate(url)`.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../src/adapters/pg-connect.js";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Thrown, before anything is applied, when an applied migration's file has changed since, has no
 * checksum on record, or is gone. `files` names them all, in filename order.
 */
export class ChangedMigrationError extends Error {
  readonly files: string[];

  constructor(files: string[]) {
    super(
      `Refusing to migrate: ${files.join(", ")} changed after being applied to this database. Rebuild a local database from empty with \`npm run db:rebuild:dev\`, then reseed.`,
    );
    this.name = "ChangedMigrationError";
    this.files = files;
  }
}

const checksum = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** The local dev database (docker-compose.yml). */
export const DEFAULT_DATABASE_URL = "postgres://haul:haul@localhost:5434/haul_dev";

/** Applies every pending migration in `dir` to the database at `url`. Returns the files applied. */
export async function migrate(url: string = DEFAULT_DATABASE_URL, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const client = createClient(url);
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      `create table if not exists _migrations (
         filename text primary key,
         applied_at timestamptz not null default now(),
         checksum text
       )`,
    );
    // A ledger made before checksums existed gets the column here, outside any transaction and
    // before the comparison, so a refusal leaves it in place with the old rows' checksum null.
    await client.query("alter table _migrations add column if not exists checksum text");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const recorded = (
      await client.query<{ filename: string; checksum: string | null }>(
        "select filename, checksum from _migrations order by filename",
      )
    ).rows;
    const changed: string[] = [];
    for (const row of recorded) {
      const bytes = files.includes(row.filename) ? await readFile(join(dir, row.filename)) : undefined;
      if (!bytes || row.checksum !== checksum(bytes)) changed.push(row.filename);
    }
    if (changed.length) throw new ChangedMigrationError(changed.sort());
    const done = new Set(recorded.map((r) => r.filename));
    for (const file of files) {
      if (done.has(file)) continue;
      const bytes = await readFile(join(dir, file));
      await client.query("begin");
      try {
        await client.query(bytes.toString("utf8"));
        await client.query("insert into _migrations (filename, checksum) values ($1, $2)", [file, checksum(bytes)]);
        await client.query("commit");
        applied.push(file);
      } catch (e) {
        // A rollback that fails too (the connection died) must not replace the migration's error.
        await client.query("rollback").catch(() => undefined);
        throw e;
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

// CLI: `tsx db/migrate.ts [url]`. Deliberately not DATABASE_URL: with a production URL exported in
// the shell, `npm run db:migrate` would migrate production unprompted. Write protection is task 1.8.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate(process.argv[2] ?? DEFAULT_DATABASE_URL)
    .then((applied) => console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Up to date."))
    .catch((e: unknown) => {
      // The refusal's message is the whole report; a stack adds nothing.
      console.error(e instanceof ChangedMigrationError ? e.message : e);
      process.exit(1);
    });
}
