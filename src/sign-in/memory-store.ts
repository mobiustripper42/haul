import type { RateLimitStore, SignInCode, SignInStore } from "./store.js";

/**
 * The folder's own permanent fake (DEC-010), standing in for a database in the code-flow tests.
 * `runSignInStoreContract` runs against it as well as against haul's adapters, which proves it
 * behaves as they do.
 */
export class MemorySignInStore implements SignInStore, RateLimitStore {
  private readonly codes = new Map<string, SignInCode>();
  private readonly hits = new Map<string, { expiresAt: Date; hits: number }>();

  async getSignInCode(subjectId: string): Promise<SignInCode | null> {
    const code = this.codes.get(subjectId);
    return code ? copy(code) : null;
  }

  async saveSignInCode(code: { subjectId: string; codeHash: string; createdAt: Date; expiresAt: Date }): Promise<void> {
    const before = this.codes.get(code.subjectId);
    this.codes.set(code.subjectId, {
      subjectId: code.subjectId,
      codeHash: code.codeHash,
      createdAt: new Date(code.createdAt),
      expiresAt: new Date(code.expiresAt),
      attempts: 0,
      consumedAt: null,
      failedSince: before?.failedSince ?? null,
      failedInWindow: before?.failedInWindow ?? 0,
    });
  }

  async claimSignInAttempt(
    subjectId: string | null,
    claim: { presentedHash: string; maxAttempts: number; now: Date; windowMs: number; maxFailures: number },
  ): Promise<{ codeHash: string; expiresAt: Date } | null> {
    const code = subjectId === null ? undefined : this.codes.get(subjectId);
    if (!code || code.consumedAt !== null || code.attempts >= claim.maxAttempts) return null;

    const wrong = claim.presentedHash !== code.codeHash;
    const live = code.failedSince !== null && claim.now.getTime() < code.failedSince.getTime() + claim.windowMs;
    if (wrong && live && code.failedInWindow >= claim.maxFailures) return null;

    code.attempts += 1;
    if (wrong) {
      if (live) {
        code.failedInWindow += 1;
      } else {
        code.failedSince = new Date(claim.now);
        code.failedInWindow = 1;
      }
    }
    return { codeHash: code.codeHash, expiresAt: new Date(code.expiresAt) };
  }

  async consumeSignInCode(subjectId: string, now: Date): Promise<boolean> {
    const code = this.codes.get(subjectId);
    if (!code || code.consumedAt !== null) return false;
    code.consumedAt = new Date(now);
    return true;
  }

  async incrementRateLimit(
    bucket: string,
    key: string,
    windowStart: Date,
    expiresAt: Date,
    now: Date,
  ): Promise<number> {
    for (const [id, row] of this.hits) if (row.expiresAt.getTime() <= now.getTime()) this.hits.delete(id);
    const id = JSON.stringify([bucket, key, windowStart.getTime()]);
    const row = this.hits.get(id) ?? { expiresAt: new Date(expiresAt), hits: 0 };
    row.hits += 1;
    this.hits.set(id, row);
    return row.hits;
  }
}

// Callers get their own object, as they would from a database row, so mutating one can't edit the store.
const copy = (code: SignInCode): SignInCode => ({
  ...code,
  createdAt: new Date(code.createdAt),
  expiresAt: new Date(code.expiresAt),
  consumedAt: code.consumedAt && new Date(code.consumedAt),
  failedSince: code.failedSince && new Date(code.failedSince),
});
