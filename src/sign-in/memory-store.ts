import { isLocked, isWindowLive } from "./code.js";
import type { RateLimitStore, SaveHold, SignInCode, SignInStore } from "./store.js";

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

  async saveSignInCode(
    code: { subjectId: string; codeHash: string; createdAt: Date; expiresAt: Date },
    hold?: SaveHold,
  ): Promise<boolean> {
    const before = this.codes.get(code.subjectId);
    if (before && hold && isHeld(before, hold)) return false;
    this.codes.set(code.subjectId, {
      subjectId: code.subjectId,
      codeHash: code.codeHash,
      createdAt: new Date(code.createdAt),
      expiresAt: new Date(code.expiresAt),
      attempts: 0,
      consumedAt: null,
      failedSince: before?.failedSince ?? null,
      failedInWindow: before?.failedInWindow ?? 0,
      linkHash: before?.linkHash ?? null,
      linkCreatedAt: before?.linkCreatedAt ?? null,
      linkExpiresAt: before?.linkExpiresAt ?? null,
    });
    return true;
  }

  async claimSignInAttempt(
    subjectId: string | null,
    claim: { presentedHash: string; maxAttempts: number; now: Date; windowMs: number; maxFailures: number },
  ): Promise<{ codeHash: string; expiresAt: Date; failedInWindow: number } | null> {
    const code = subjectId === null ? undefined : this.codes.get(subjectId);
    if (!code || code.consumedAt !== null || code.attempts >= claim.maxAttempts) return null;

    if (isLocked(code, claim)) return null;
    const wrong = claim.presentedHash !== code.codeHash;
    const live = isWindowLive(code, claim);

    code.attempts += 1;
    if (wrong) {
      if (live) {
        code.failedInWindow += 1;
      } else {
        code.failedSince = new Date(claim.now);
        code.failedInWindow = 1;
      }
    }
    return { codeHash: code.codeHash, expiresAt: new Date(code.expiresAt), failedInWindow: code.failedInWindow };
  }

  async consumeSignInCode(subjectId: string, now: Date): Promise<boolean> {
    const code = this.codes.get(subjectId);
    if (!code || code.consumedAt !== null) return false;
    code.consumedAt = new Date(now);
    return true;
  }

  async saveSignInLink(
    link: { subjectId: string; linkHash: string; createdAt: Date; expiresAt: Date },
    hold?: SaveHold,
  ): Promise<boolean> {
    const code = this.codes.get(link.subjectId);
    if (!code || (hold && isHeld(code, hold))) return false;
    code.linkHash = link.linkHash;
    code.linkCreatedAt = new Date(link.createdAt);
    code.linkExpiresAt = new Date(link.expiresAt);
    return true;
  }

  async redeemSignInLink(linkHash: string, now: Date): Promise<string | null> {
    for (const code of this.codes.values()) {
      if (code.linkHash !== linkHash || code.linkExpiresAt === null || now.getTime() >= code.linkExpiresAt.getTime()) continue;
      code.linkHash = null;
      code.linkCreatedAt = null;
      code.linkExpiresAt = null;
      code.failedSince = null;
      code.failedInWindow = 0;
      code.consumedAt ??= new Date(now);
      return code.subjectId;
    }
    return null;
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

/**
 * The hold both saves share: an unused code, or an unused link, created less than `waitMs` before
 * `now`. A consumed code and a redeemed link (whose fields are cleared) do not hold.
 */
const isHeld = (code: SignInCode, hold: SaveHold): boolean => {
  const within = (created: Date): boolean => hold.now.getTime() - created.getTime() < hold.waitMs;
  return (code.consumedAt === null && within(code.createdAt)) || (code.linkCreatedAt !== null && within(code.linkCreatedAt));
};

// Callers get their own object, as they would from a database row, so mutating one can't edit the store.
const copy = (code: SignInCode): SignInCode => ({
  ...code,
  createdAt: new Date(code.createdAt),
  expiresAt: new Date(code.expiresAt),
  consumedAt: code.consumedAt && new Date(code.consumedAt),
  failedSince: code.failedSince && new Date(code.failedSince),
  linkCreatedAt: code.linkCreatedAt && new Date(code.linkCreatedAt),
  linkExpiresAt: code.linkExpiresAt && new Date(code.linkExpiresAt),
});
