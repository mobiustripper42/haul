// The Repository contract against real Postgres (AC7), in a database of its own (AC9):
// `<test db>_repository`, created if absent, migrated once, truncated before each test.
// Without a reachable Postgres it skips locally and fails in CI (AC8).
import { afterAll, beforeAll, describe } from "vitest";
import { migrate } from "../../db/migrate.js";
import { createPool } from "./pg-connect.js";
import { PostgresRepository } from "./postgres-repository.js";
import { runRepositoryContract } from "./repository-contract.js";
import { ensureTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "./test-database.js";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC9 — Postgres contract in <test db>_repository${skipped}`, () => {
  let pool: ReturnType<typeof createPool>;
  let repo: PostgresRepository;

  beforeAll(async () => {
    const url = await ensureTestDatabase(TEST_DATABASE_URL, "repository");
    await migrate(url);
    pool = createPool(url);
    repo = new PostgresRepository(url);
  });

  afterAll(async () => {
    await repo?.close();
    await pool?.end();
  });

  // Every table but the migration ledger, read from the catalog so a later migration's table
  // can't be missed. Truncating `_migrations` would make the next `migrate` replay everything.
  const truncateAll = async (): Promise<void> => {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
    );
    if (rows.length === 0) return;
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  };

  runRepositoryContract("postgres", async () => repo, truncateAll);
});
