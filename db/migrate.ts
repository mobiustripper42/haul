/**
 * Migration runner (DEC-013). Applies db/migrations/*.sql in filename order, each in its own
 * transaction, tracked in `_migrations` so a re-run is a no-op. Plain SQL, forward only.
 *
 * Used two ways: the `db:migrate` CLI, and the Postgres suites, which call `migrate(url)`.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../src/adapters/pg-connect.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

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
         applied_at timestamptz not null default now()
       )`,
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set(
      (await client.query<{ filename: string }>("select filename from _migrations")).rows.map((r) => r.filename),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _migrations (filename) values ($1)", [file]);
        await client.query("commit");
        applied.push(file);
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

// CLI: `tsx db/migrate.ts [url]`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate(process.argv[2] ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL)
    .then((applied) => console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Up to date."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
