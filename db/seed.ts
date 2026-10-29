/**
 * Dev seeds: named, re-runnable data for by-hand checks. `npm run db:seed:<name>` loads one into
 * haul_dev (or the URL given). Production configuration is a different mechanism (DEC-007).
 *
 * The rules every seed keeps; `db/seed.test.ts` runs every seed in `SEEDS` against them:
 * - Alone (AC3): a seed that needs another seed's rows makes them itself.
 * - Twice (AC4): a second run leaves every table's contents exactly as after the first, so a seed
 *   never stamps the current time or a fresh random value on a row it already made.
 * - Stacked (AC5): any order of seeds gives the same result.
 * - Only its own rows (AC6): a seed puts back the columns it names on the rows it names, and
 *   touches nothing else. Upsert, never delete-and-reinsert: an `id` survives a re-run.
 * - Local only (AC9): `runSeed` refuses a URL whose host is not the dev box, before connecting.
 * - Rows only: schema changes go through migrations (DEC-013).
 *
 * Adding a seed: a file `db/seeds/<name>.ts` exporting `seed`, a key in `SEEDS`, and a
 * `db:seed:<name>` script in package.json. The test fails naming any of the three that is missing.
 */
import { fileURLToPath } from "node:url";
import { createClient } from "../src/adapters/pg-connect.js";
import type { Client } from "../src/adapters/pg-connect.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";
import { seed as members } from "./seeds/members.js";

export type Seed = (db: Client) => Promise<void>;

export const SEEDS: Readonly<Record<string, Seed>> = { members };

/** Hostnames as `URL` reports them: IPv6 keeps its brackets. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Query parameters `pg-connection-string` lets replace the URL's authority host. */
const OVERRIDE_HOST_PARAMS = ["host", "hostaddr"];

/** Throws unless `url` points at the local dev box. Seeds and resets are dev only. */
export function assertLocalUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // The URL is not echoed: it can carry a password.
    throw new Error("Refusing to run: the database URL does not parse, so its host cannot be checked.");
  }
  for (const param of OVERRIDE_HOST_PARAMS) {
    if (parsed.searchParams.has(param)) {
      throw new Error(`Refusing to run: the database URL carries a "${param}" parameter, which replaces its host.`);
    }
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Refusing to run: host "${parsed.hostname}" is not local. Dev seeds and resets run only against localhost, 127.0.0.1 or [::1].`,
    );
  }
}

/** Runs the seed called `name` against the database at `url`, in one transaction. */
export async function runSeed(name: string, url: string = DEFAULT_DATABASE_URL): Promise<void> {
  const run = Object.hasOwn(SEEDS, name) ? SEEDS[name] : undefined;
  if (!run) {
    throw new Error(`No seed named "${name}". Seeds: ${Object.keys(SEEDS).join(", ")}.`);
  }
  assertLocalUrl(url);
  const db = createClient(url);
  await db.connect();
  try {
    await db.query("begin");
    try {
      await run(db);
      await db.query("commit");
    } catch (e) {
      // A rollback that fails too (the connection died) must not replace the seed's error.
      await db.query("rollback").catch(() => undefined);
      throw e;
    }
  } finally {
    await db.end();
  }
}

// CLI: `tsx db/seed.ts <name> [url]`. Deliberately not DATABASE_URL, for the reason at db/migrate.ts:54-55.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const name = process.argv[2];
  if (!name) {
    console.error(`Usage: tsx db/seed.ts <name> [url]. Seeds: ${Object.keys(SEEDS).join(", ")}.`);
    process.exit(1);
  }
  runSeed(name, process.argv[3] ?? DEFAULT_DATABASE_URL)
    .then(() => console.log(`Seeded: ${name}.`))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
