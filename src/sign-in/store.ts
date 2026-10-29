/**
 * What the sign-in flow needs from storage. A subject is only `{ id, email }`: this folder never
 * knows a member, a language or a repository, so it can be lifted into a shared library.
 */
export type SignInSubject = { id: string; email: string };

export type SignInCode = {
  subjectId: string;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  /** Start of the subject's wrong-guess window, across every code the subject has had. */
  failedSince: Date | null;
  failedInWindow: number;
};

export interface SignInStore {
  getSignInCode(subjectId: string): Promise<SignInCode | null>;
  /** An upsert per subject. A new code resets `attempts` and `consumedAt` and keeps the failure window. */
  saveSignInCode(code: { subjectId: string; codeHash: string; createdAt: Date; expiresAt: Date }): Promise<void>;
  /**
   * Takes one guess at the subject's code, in one atomic step so concurrent claims cannot pass a cap
   * together. "The window is live" means `failedSince` is set and `now < failedSince + windowMs`.
   *
   * 1. A null subject id, no code, a consumed code, or `attempts >= maxAttempts`: null, nothing changes.
   * 2. `presentedHash` differs from `codeHash`, the window is live and `failedInWindow >= maxFailures`:
   *    null, nothing changes.
   * 3. Otherwise `attempts` goes up by 1 and `{ codeHash, expiresAt }` is returned. A wrong
   *    `presentedHash` also counts in the window: live, `failedInWindow` goes up by 1; otherwise
   *    `failedSince = now` and `failedInWindow = 1`.
   * 4. Expiry is not checked here; `verifySignInCode` checks it after the claim.
   */
  claimSignInAttempt(
    subjectId: string | null,
    claim: { presentedHash: string; maxAttempts: number; now: Date; windowMs: number; maxFailures: number },
  ): Promise<{ codeHash: string; expiresAt: Date } | null>;
  /** True once per code: the first call consumes it, every later one (and a subject with no code) is false. */
  consumeSignInCode(subjectId: string, now: Date): Promise<boolean>;
}

export interface RateLimitStore {
  /**
   * Deletes every row whose `expiresAt` is at or before `now`, then counts one more hit on
   * `(bucket, key, windowStart)` and returns the count: 1, 2, 3, ...
   */
  incrementRateLimit(bucket: string, key: string, windowStart: Date, expiresAt: Date, now: Date): Promise<number>;
}
