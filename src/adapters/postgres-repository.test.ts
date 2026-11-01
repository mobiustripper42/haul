// The Repository contract against real Postgres (AC7), in a database of its own (AC9):
// `<test db>_repository`, created if absent, migrated once, truncated before each test.
// Without a reachable Postgres it skips locally and fails in CI (AC8).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../db/migrate.js";
import { hashCode, issueSignInCode } from "../sign-in/code.js";
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

  // Issue 22: Postgres only. The lock, the hold and the redeem are each decided in one atomic
  // statement, so callers that arrive together cannot pass them together.
  describe("issue 22 — the lock, the hold and the link under concurrency", () => {
    const T0 = new Date("2026-10-28T14:00:00.000Z");
    const MINUTE = 60_000;
    const DAY = 24 * 60 * MINUTE;
    const RIGHT = "a".repeat(64);
    const WRONG = "f".repeat(64);
    const LINK = "c".repeat(64);

    const member = async () => repo.createMember({ email: "ada@example.com" });
    const saveCode = (subjectId: string, createdAt: Date) =>
      repo.saveSignInCode({ subjectId, codeHash: RIGHT, createdAt, expiresAt: new Date(createdAt.getTime() + 10 * MINUTE) });

    it("AC6: 10 concurrent wrong-guess claims with maxAttempts 10 and maxFailures 5 return exactly 5 non-null results, one of them carrying failedInWindow 5, and leave failedInWindow 5", async () => {
      await truncateAll();
      const { id } = await member();
      await saveCode(id, T0);
      const now = new Date(T0.getTime() + MINUTE);
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          repo.claimSignInAttempt(id, { presentedHash: WRONG, maxAttempts: 10, now, windowMs: DAY, maxFailures: 5 }),
        ),
      );
      const claimed = results.filter((r) => r !== null);
      expect(claimed).toHaveLength(5);
      expect(claimed.filter((r) => r.failedInWindow === 5)).toHaveLength(1);
      expect(await repo.getSignInCode(id)).toMatchObject({ failedInWindow: 5 });
    });

    it("AC33: 10 concurrent issueSignInCode calls outside the wait store exactly one code and return { send: 'code' } exactly once", async () => {
      await truncateAll();
      const subject = await member();
      const codes = Array.from({ length: 10 }, (_, i) => String(300000 + i));
      const outcomes = await Promise.all(
        codes.map((code) =>
          issueSignInCode(repo, { subject, code, codeHash: hashCode(code) }, { now: T0, mintLinkToken: () => "tok-never" }),
        ),
      );
      const sent = codes.filter((_, i) => outcomes[i]?.send === "code");
      expect(sent).toHaveLength(1);
      expect(outcomes.filter((o) => o.send === "nothing")).toHaveLength(9);
      expect((await repo.getSignInCode(subject.id))?.codeHash).toBe(hashCode(sent[0] ?? "none sent"));
    });

    it("AC33: for a locked member, 10 concurrent issueSignInCode calls save exactly one link and return { send: 'link' } exactly once", async () => {
      await truncateAll();
      const subject = await member();
      await saveCode(subject.id, T0);
      for (let g = 1; g <= 5; g++) {
        await repo.claimSignInAttempt(subject.id, {
          presentedHash: WRONG,
          maxAttempts: 5,
          now: new Date(T0.getTime() + g * 1000),
          windowMs: DAY,
          maxFailures: 5,
        });
      }
      const before = await repo.getSignInCode(subject.id);
      expect(before).toMatchObject({ codeHash: RIGHT, failedInWindow: 5 });

      const now = new Date(T0.getTime() + 10 * MINUTE);
      const outcomes = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          issueSignInCode(
            repo,
            { subject, code: String(300000 + i), codeHash: hashCode(String(300000 + i)) },
            { now, mintLinkToken: () => `tok-${i}` },
          ),
        ),
      );
      const links = outcomes.flatMap((o) => (o.send === "link" ? [o.token] : []));
      expect(links).toHaveLength(1);
      expect(outcomes.filter((o) => o.send === "nothing")).toHaveLength(9);
      expect(await repo.getSignInCode(subject.id)).toMatchObject({
        codeHash: RIGHT,
        linkHash: hashCode(links[0] ?? "none sent"),
        linkCreatedAt: now,
      });
    });

    it("AC14: two concurrent redeemSignInLink calls for one link return the subject id exactly once", async () => {
      await truncateAll();
      const { id } = await member();
      await saveCode(id, T0);
      await repo.saveSignInLink({ subjectId: id, linkHash: LINK, createdAt: T0, expiresAt: new Date(T0.getTime() + 10 * MINUTE) });
      const now = new Date(T0.getTime() + MINUTE);
      const results = await Promise.all([repo.redeemSignInLink(LINK, now), repo.redeemSignInLink(LINK, now)]);
      expect(results.filter((r) => r !== null)).toEqual([id]);
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

  // Postgres only: the typed port gives the in-memory adapter no way to store an unsupported role.
  describe("AC2 (issue 10) — members.role defaults to member and accepts only ROLES", () => {
    const CHECK_VIOLATION = "23514";

    it("AC2 (issue 10): a raw insert that names no role reads back role member", async () => {
      await truncateAll();
      await pool.query("insert into members (email) values ($1)", ["ada@example.com"]);
      // Read through to_jsonb so a missing column reads as null rather than erroring.
      const { rows } = await pool.query<{ role: string | null }>(
        "select to_jsonb(m) ->> 'role' as role from members m where email = $1",
        ["ada@example.com"],
      );
      expect(rows).toEqual([{ role: "member" }]);
    });

    it.each(["owner", "Admin"])("AC2 (issue 10): a raw insert with role %j fails with a check violation", async (role) => {
      await truncateAll();
      const insert = pool.query("insert into members (email, role) values ($1, $2)", ["ada@example.com", role]);
      await expect(insert).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });
});
