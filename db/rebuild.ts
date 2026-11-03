/**
 * Drops a local database and recreates it empty, then applies every migration: the answer to a
 * `ChangedMigrationError` (db/migrate.ts). Dev only: it refuses a URL whose host is not local,
 * before connecting. It lives apart from `migrate.ts` because that file runs against production,
 * and the local-host check here keeps any caller from dropping a remote database. It does not seed.
 */
import { fileURLToPath } from "node:url";
import { createClient } from "../src/adapters/pg-connect.js";
import { DEFAULT_DATABASE_URL, MIGRATIONS_DIR, migrate } from "./migrate.js";
import { assertLocalUrl } from "./seed.js";

/** Returns the files applied, in filename order. */
export async function rebuildDatabase(url: string, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  assertLocalUrl(url);
  const name = new URL(url).pathname.replace(/^\//, "");
  // `drop database` can't run on the database being dropped, so connect to the server's `postgres`.
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = createClient(admin.toString(), { connectionTimeoutMillis: 2000 });
  await client.connect();
  try {
    const quoted = client.escapeIdentifier(name);
    await client.query(`drop database if exists ${quoted} with (force)`);
    await client.query(`create database ${quoted}`);
  } finally {
    await client.end();
  }
  return migrate(url, dir);
}

// CLI: `tsx db/rebuild.ts [url]`. Deliberately not DATABASE_URL, for the reason at db/migrate.ts.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rebuildDatabase(process.argv[2] ?? DEFAULT_DATABASE_URL)
    .then((applied) => console.log(`Rebuilt: applied ${applied.join(", ")}.`))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
