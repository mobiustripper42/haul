// The Repository contract against real Postgres (AC7), in a database of its own (AC9):
// `<test db>_repository`, created if absent, migrated once, truncated before each test.
// Without a reachable Postgres it skips locally and fails in CI (AC8).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../db/migrate.js";
import { runSignInStoreContract } from "../sign-in/store-contract.js";
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

  // Issue 9, AC16–AC19: the sign-in store contract, a subject being a real member row.
  runSignInStoreContract(
    "postgres",
    async () => ({ store: repo, makeSubject: async (email) => (await repo.createMember({ email })).id }),
    truncateAll,
  );

  // Issue 9: Postgres only. Each claim, consume and increment is one atomic statement, so
  // concurrent callers cannot pass a cap together.
  describe("issue 9 — sign-in store under concurrency", () => {
    const T0 = new Date("2026-10-28T14:00:00.000Z");
    const MINUTE = 60_000;
    const DAY = 24 * 60 * MINUTE;
    const RIGHT = "a".repeat(64);
    const WRONG = "f".repeat(64);

    const memberWithCode = async (): Promise<string> => {
      const { id } = await repo.createMember({ email: "ada@example.com" });
      await repo.saveSignInCode({
        subjectId: id,
        codeHash: RIGHT,
        createdAt: T0,
        expiresAt: new Date(T0.getTime() + 10 * MINUTE),
      });
      return id;
    };

    it("AC17 (issue 9): two concurrent consumeSignInCode calls on one code return exactly one true", async () => {
      await truncateAll();
      const id = await memberWithCode();
      const now = new Date(T0.getTime() + MINUTE);
      const results = await Promise.all([repo.consumeSignInCode(id, now), repo.consumeSignInCode(id, now)]);
      expect(results.filter((won) => won)).toHaveLength(1);
    });

    it("AC18 (issue 9): 10 concurrent wrong-guess claims with maxAttempts 3 return exactly 3 non-null results, leaving attempts 3 and failedInWindow 3", async () => {
      await truncateAll();
      const id = await memberWithCode();
      const now = new Date(T0.getTime() + MINUTE);
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          repo.claimSignInAttempt(id, { presentedHash: WRONG, maxAttempts: 3, now, windowMs: DAY, maxFailures: 50 }),
        ),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(3);
      expect(await repo.getSignInCode(id)).toMatchObject({ attempts: 3, failedInWindow: 3 });
    });

    it("AC19 (issue 9): 25 concurrent incrementRateLimit calls on one window return 1 through 25, each exactly once", async () => {
      await truncateAll();
      const windowStart = T0;
      const expiresAt = new Date(T0.getTime() + 60 * MINUTE);
      const now = new Date(T0.getTime() + MINUTE);
      const counts = await Promise.all(
        Array.from({ length: 25 }, () =>
          repo.incrementRateLimit("sign-in-request", "203.0.113.7", windowStart, expiresAt, now),
        ),
      );
      expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    });
  });

  // Postgres only: the typed port gives the in-memory adapter no way to store an unsupported code.
  describe("AC10 (issue 7) — members.language accepts only en and es", () => {
    const CHECK_VIOLATION = "23514";

    it.each(["ES", "fr"])("AC10 (issue 7): a raw insert with language %j fails with a check violation", async (language) => {
      await truncateAll();
      const insert = pool.query("insert into members (email, language) values ($1, $2)", [
        "ada@example.com",
        language,
      ]);
      await expect(insert).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });
});
