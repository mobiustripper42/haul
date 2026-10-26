import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./pg-connect.js";
import { ensureTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "./test-database.js";

// Port 1 on loopback refuses at once; 192.0.2.1 (TEST-NET-1, RFC 5737) never answers, so only
// the 2 s connect timeout ends the attempt.
const REFUSED = "postgres://haul:haul@127.0.0.1:1/haul_test";
const SILENT = "postgres://haul:haul@192.0.2.1:5432/haul_test";

describe("AC8 — requireTestDatabase", () => {
  it("AC8: returns false for an unreachable database when not in CI", async () => {
    await expect(requireTestDatabase(REFUSED, { ci: false })).resolves.toBe(false);
  });

  it("AC8: throws, naming `npm run db:up`, for an unreachable database in CI", async () => {
    await expect(requireTestDatabase(REFUSED, { ci: true })).rejects.toThrow(/npm run db:up/);
  });

  it("AC8: gives up after about 2 s on a host that never answers", async () => {
    const started = Date.now();
    await expect(requireTestDatabase(SILENT, { ci: false })).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(4000);
  }, 10_000);
});

describe("AC8 — TEST_DATABASE_URL, the one value every Postgres-backed suite uses", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const fresh = async () => (await import("./test-database.js")).TEST_DATABASE_URL;

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("AC8: defaults to haul_test on port 5434 when the variable is %s", async (_label, value) => {
    vi.stubEnv("TEST_DATABASE_URL", value);
    vi.resetModules();
    expect(await fresh()).toBe("postgres://haul:haul@localhost:5434/haul_test");
  });

  it("AC8: uses the variable when it is set", async () => {
    vi.stubEnv("TEST_DATABASE_URL", "postgres://haul:haul@localhost:5432/haul_test");
    vi.resetModules();
    expect(await fresh()).toBe("postgres://haul:haul@localhost:5432/haul_test");
  });
});

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC9 — ensureTestDatabase${skipped}`, () => {
  const base = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
  const name = `${base}_ensure`;

  const withClient = async <T>(url: string, fn: (client: ReturnType<typeof createClient>) => Promise<T>) => {
    const client = createClient(url);
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  };

  const adminUrl = () => {
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = "/postgres";
    return url.toString();
  };

  // The created-if-absent path runs every time.
  beforeEach(async () => {
    await withClient(adminUrl(), (c) => c.query(`drop database if exists "${name}" with (force)`));
  });

  it("AC9: creates <test db>_ensure when absent and returns its URL", async () => {
    const url = await ensureTestDatabase(TEST_DATABASE_URL, "ensure");

    const returned = new URL(url);
    const given = new URL(TEST_DATABASE_URL);
    expect(returned.pathname).toBe(`/${name}`);
    expect([returned.username, returned.password, returned.hostname, returned.port]).toEqual([
      given.username,
      given.password,
      given.hostname,
      given.port,
    ]);

    const { rows } = await withClient(url, (c) => c.query<{ db: string }>("select current_database() as db"));
    expect(rows[0]?.db).toBe(name);
  });

  it("AC9: only creates the database — it migrates nothing", async () => {
    const url = await ensureTestDatabase(TEST_DATABASE_URL, "ensure");
    const { rows } = await withClient(url, (c) =>
      c.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'"),
    );
    expect(rows).toEqual([]);
  });

  it("AC9: a second call, with the database already there, returns the same URL without throwing", async () => {
    const first = await ensureTestDatabase(TEST_DATABASE_URL, "ensure");
    await expect(ensureTestDatabase(TEST_DATABASE_URL, "ensure")).resolves.toBe(first);
  });
});
