/**
 * The only module that imports `pg` (DEC-001, enforced by lint). Every connection is built here,
 * and TLS is decided here, so no caller can forget it.
 *
 * A non-local host is trusted against node's root certificates plus the farm's Crunchy team root.
 */
import tls from "node:tls";
import pg from "pg";

export type { Client, ClientConfig, DatabaseError, Pool, PoolClient, PoolConfig } from "pg";

/** What `pg` accepts for `ssl`; the subset of node's TLS options this module sets. */
export type DbSslConfig = { ca: string[]; rejectUnauthorized: true };

/** Hosts that run a plain, TLS-less Postgres: the dev box, and nothing else. The dev seeds' guard reads it too. */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * libpq ssl parameters. They must be removed from the connection string, not merely ignored:
 * `pg` merges the parsed string over the caller's config, and `pg-connection-string` sets `ssl`
 * whenever `sslmode` is present, so one left in would silently replace the `ssl` set here.
 */
const SSL_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "ssl"];

/** Query parameters `pg-connection-string` lets replace the URL's authority host. */
export const OVERRIDE_HOST_PARAMS: readonly string[] = ["host", "hostaddr"];

/**
 * The farm's Crunchy Bridge team root (issue 126). Crunchy issues each team its own self-signed
 * root, `CN` the team id, so node's store rejects it. Committed, not configured: a CA carries only
 * a public key, and an env var someone forgets fails at connection time, in production. Runs to
 * 2046. Muster's `src/config/db-ssl.ts` is the same pattern, for its own team.
 */
export const CRUNCHY_TEAM_CA = `-----BEGIN CERTIFICATE-----
MIIBpDCCAUqgAwIBAgIJALG7c7x0SYpdMAoGCCqGSM49BAMDMCUxIzAhBgNVBAMM
Gmx1enJuY3piZGJkcWJoaGl5Y2J3ZHR5Z3BhMB4XDTI2MTExMDAzMjgzMVoXDTQ2
MTEwNTAzMjgzMVowJTEjMCEGA1UEAwwabHV6cm5jemJkYmRxYmhoaXljYndkdHln
cGEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATQ7z4rMKCKQfZX7mCuedpbnKir
+IPEsZtJaULb5yUfo9QW9DHNXqtH2gG59wiZf8tl7A0Zy1MiHFeV7pjy+jVLo2Mw
YTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAdBgNVHQ4EFgQUWq94
nu0oI2upRGK2jfdxSzy2AzEwHwYDVR0jBBgwFoAUWq94nu0oI2upRGK2jfdxSzy2
AzEwCgYIKoZIzj0EAwMDSAAwRQIgJr0nc0Rqi5XcVcQU5pW0Y0AGErHl9fYHbhyW
vLU/K24CIQCk1hdQme+H0895OQ64w4llokcWx18le3lCu73E5O+UYA==
-----END CERTIFICATE-----
`;

// Appended to node's roots, never substituted: `ssl: { ca }` replaces the trust store outright.
const TRUST: DbSslConfig = { ca: [...tls.rootCertificates, CRUNCHY_TEAM_CA], rejectUnauthorized: true };

/**
 * The `pg` config for a database URL: the connection string with every ssl parameter stripped,
 * plus an explicit `ssl` that therefore survives.
 *
 * TLS is decided by the host, not by `sslmode`: a local host gets none, anything else gets
 * verified TLS, and nothing in the URL can weaken that except the explicit `sslmode=disable`.
 * A URL that won't parse requires TLS, so being wrong lands on the safe side.
 */
export function pgConnectionConfig(url: string): { connectionString: string; ssl?: DbSslConfig } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Silent on purpose: the only thing to log is the malformed value, a connection string with a password in it.
    return { connectionString: url, ssl: TRUST };
  }

  const sslmode = parsed.searchParams.get("sslmode");
  for (const param of SSL_PARAMS) parsed.searchParams.delete(param);
  const connectionString = parsed.toString();

  // `pg-connection-string` lets these override the authority host, so a URL carrying either is not local.
  const overridesHost = OVERRIDE_HOST_PARAMS.some((param) => parsed.searchParams.has(param));
  const plain = (LOCAL_HOSTS.has(parsed.hostname) && !overridesHost) || sslmode === "disable";
  return plain ? { connectionString } : { connectionString, ssl: TRUST };
}

/** `extra` carries options such as `connectionTimeoutMillis`, never TLS. */
export function createPool(url: string, extra: Omit<pg.PoolConfig, "connectionString" | "ssl"> = {}): pg.Pool {
  const pool = new pg.Pool({ ...extra, ...pgConnectionConfig(url) });
  // Without a listener, an idle client dropped by the server is an uncaught exception that kills the process.
  // Log the message only: the error object can carry the connection string, and its password.
  pool.on("error", (err) => console.error(`postgres pool: idle client error: ${err.message}`));
  return pool;
}

export function createClient(url: string, extra: Omit<pg.ClientConfig, "connectionString" | "ssl"> = {}): pg.Client {
  return new pg.Client({ ...extra, ...pgConnectionConfig(url) });
}
