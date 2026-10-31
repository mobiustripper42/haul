/**
 * Test-database helpers shared by every Postgres-backed suite (the contract, `migrate`,
 * `ensureTestDatabase`). Test-only: nothing that ships imports this.
 */
import { createClient } from "./pg-connect.js";

/** The one database URL every Postgres-backed suite starts from. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://haul:haul@localhost:5434/haul_test";

/**
 * Whether a Postgres is reachable at `url`, within 2 s. When it isn't: `false` locally, so the
 * suite skips, and a throw in CI, so the build fails rather than going green without the
 * contract having run.
 */
export async function requireTestDatabase(url: string, opts: { ci: boolean }): Promise<boolean> {
  const client = createClient(url, { connectionTimeoutMillis: 2000 });
  // A failed connect can still emit 'error' on the client; there is nothing to do with it.
  client.on("error", () => {});
  try {
    await client.connect();
  } catch (cause) {
    if (opts.ci) {
      throw new Error(`No Postgres reachable at TEST_DATABASE_URL — start one with \`npm run db:up\``, { cause });
    }
    return false;
  }
  await client.end();
  return true;
}

/** `baseUrl` with `_<suffix>` appended to its database name, the query string kept. */
export function testDatabaseUrl(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname}_${suffix}`;
  return url.toString();
}

/**
 * `<base>_<suffix>`, created if absent. Returns its URL. It only creates the database: the suite
 * calls `migrate` itself.
 *
 * `create database` can't run in a transaction or against the database being created, so this
 * connects to the server's `postgres` database. Postgres has no `if not exists` for it, so losing
 * a race is caught by SQLSTATE: `42P04` when the other creator has committed, `23505` (a unique
 * violation in the catalog) when both are in flight. Anything else is a real failure.
 */
export async function ensureTestDatabase(baseUrl: string, suffix: string): Promise<string> {
  const url = new URL(testDatabaseUrl(baseUrl, suffix));
  const name = url.pathname.replace(/^\//, "");

  const admin = new URL(baseUrl);
  admin.pathname = "/postgres";
  const client = createClient(admin.toString(), { connectionTimeoutMillis: 2000 });
  await client.connect();
  try {
    // An identifier can't be a bound parameter; it is the URL's database plus a literal suffix
    // from the call site, quoted.
    await client.query(`create database "${name.replace(/"/g, '""')}"`);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "42P04" && code !== "23505") throw e;
  } finally {
    await client.end();
  }

  return url.toString();
}
