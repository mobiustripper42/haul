/**
 * Empties every public table but the migration ledger, for a clean start. Dev only: it refuses a
 * URL whose host is not local, before connecting. Tables are listed from the catalog, so a table a
 * later migration adds is emptied without a change here.
 */
import { fileURLToPath } from "node:url";
import { createClient } from "../src/adapters/pg-connect.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";
import { assertLocalUrl } from "./seed.js";

export async function resetDev(url: string = DEFAULT_DATABASE_URL): Promise<void> {
  assertLocalUrl(url);
  const db = createClient(url);
  await db.connect();
  try {
    const { rows } = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations' order by tablename",
    );
    if (rows.length === 0) return;
    const tables = rows.map((r) => db.escapeIdentifier(r.tablename)).join(", ");
    await db.query(`truncate ${tables} restart identity cascade`);
  } finally {
    await db.end();
  }
}

// CLI: `tsx db/reset-dev.ts [url]`. Deliberately not DATABASE_URL, for the reason at db/migrate.ts:54-55.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  resetDev(process.argv[2] ?? DEFAULT_DATABASE_URL)
    .then(() => console.log("Reset: every table emptied but _migrations."))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
