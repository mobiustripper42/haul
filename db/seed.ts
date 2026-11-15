/**
 * Dev seeds: named, re-runnable data for by-hand checks. `npm run db:seed:<name>` loads one into
 * haul_dev (or the URL given). Production's configuration is edited with SQL (DEC-007); the one
 * exception is its first write, `supper-club` with `--production` (issue 60), below.
 *
 * The rules every seed keeps; `db/seed.test.ts` runs every seed in `SEEDS` against them:
 * - Alone (AC3): a seed that needs another seed's rows makes them itself.
 * - Twice (AC4): a second run leaves every table's contents exactly as after the first, so a seed
 *   never stamps the current time or a fresh random value on a row it already made.
 * - Stacked (AC5): any order of seeds gives the same result.
 * - Only its own rows (AC6): a seed puts back the columns it names on the rows it names, and
 *   touches nothing else. Upsert, never delete-and-reinsert: an `id` survives a re-run.
 * - Local only (AC9): `runSeed` refuses a URL whose host is not the dev box, before connecting;
 *   the one exception is `supper-club` with `production` (issue 60).
 * - Rows only: schema changes go through migrations (DEC-013).
 *
 * Adding a seed: a file `db/seeds/<name>.ts` exporting `seed`, a key in `SEEDS`, and a
 * `db:seed:<name>` script in package.json. The test fails naming any of the three that is missing.
 */
import { fileURLToPath } from "node:url";
import { createClient, LOCAL_HOSTS, OVERRIDE_HOST_PARAMS } from "../src/adapters/pg-connect.js";
import type { Client } from "../src/adapters/pg-connect.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";
import { seed as members } from "./seeds/members.js";
import { seed as subscribers } from "./seeds/subscribers.js";
import { seed as supperClub } from "./seeds/supper-club.js";

export type Seed = (db: Client) => Promise<void>;

export const SEEDS: Readonly<Record<string, Seed>> = { members, subscribers, "supper-club": supperClub };

/**
 * Throws unless `url` points at the local dev box. Seeds and resets are dev only. "Local" is the
 * connection layer's own rule (`LOCAL_HOSTS`, `OVERRIDE_HOST_PARAMS`), so the two cannot drift.
 */
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

/** The one seed `production` may run: it writes production's Supper Club configuration, once (issue 60). */
const PRODUCTION_SEED = "supper-club";

/**
 * Runs the seed called `name` against the database at `url`, in one transaction.
 *
 * `production` skips the local-host guard for `supper-club` alone, and refuses unless `products` is
 * empty, so it writes production's configuration once; after that it is edited with SQL (DEC-007).
 */
export async function runSeed(
  name: string,
  url: string = DEFAULT_DATABASE_URL,
  { production = false }: { production?: boolean } = {},
): Promise<void> {
  const run = Object.hasOwn(SEEDS, name) ? SEEDS[name] : undefined;
  if (!run) {
    throw new Error(`No seed named "${name}". Seeds: ${Object.keys(SEEDS).join(", ")}.`);
  }
  if (production && name !== PRODUCTION_SEED) {
    throw new Error(`Refusing to run: --production runs only ${PRODUCTION_SEED}.`);
  }
  if (!production) assertLocalUrl(url);
  const db = createClient(url);
  await db.connect();
  try {
    await db.query("begin");
    try {
      if (production && (await db.query("select 1 from products limit 1")).rows.length > 0) {
        throw new Error("Refusing to run: products is not empty. Production's configuration is written once; edit it with SQL.");
      }
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

// CLI: `tsx db/seed.ts <name> [url] [--production]`. Deliberately not DATABASE_URL, for the reason at db/migrate.ts:54-55.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const production = args.includes("--production");
  const [name, url] = args.filter((a) => a !== "--production");
  if (!name) {
    console.error(`Usage: tsx db/seed.ts <name> [url] [--production]. Seeds: ${Object.keys(SEEDS).join(", ")}.`);
    process.exit(1);
  }
  if (production && !url) {
    console.error("--production needs the database URL: it never defaults to haul_dev.");
    process.exit(1);
  }
  runSeed(name, url ?? DEFAULT_DATABASE_URL, { production })
    .then(() => console.log(`Seeded: ${name}.`))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
