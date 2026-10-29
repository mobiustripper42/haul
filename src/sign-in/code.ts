import { createHash, randomInt } from "node:crypto";
import { takeRateLimit, type RateLimitPolicy } from "./rate-limit.js";
import type { RateLimitStore, SignInStore, SignInSubject } from "./store.js";

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const FAILURE_WINDOW_MS = 24 * 60 * 60_000;
export const MAX_FAILURES_PER_WINDOW = 50;

/** Fails open, as muster's does: the request step grants nothing by itself. */
export const SIGN_IN_REQUEST_LIMIT: RateLimitPolicy = {
  bucket: "sign-in-request",
  limit: 20,
  windowMs: 60 * 60_000,
  failOpen: true,
};

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** The app's way to find a subject by email, so this folder never names a member. */
export type FindSubject<S extends SignInSubject> = (email: string) => Promise<S | null>;

export type PendingSignInCode<S extends SignInSubject> = { subject: S; code: string; codeHash: string };

export type RequestResult<S extends SignInSubject> =
  | { outcome: "issue"; pending: PendingSignInCode<S> }
  | { outcome: "skip" }
  | { outcome: "limited"; retryAfterMs: number };

/**
 * Step one, in the request: limited per client key, then the lookup, then a code minted and hashed
 * whether or not the email is a subject's, so a stranger's request costs what a member's does.
 * Nothing is stored here; everything that depends on the match runs after the response
 * (`issueSignInCode`), so the response gives away nothing.
 */
export async function requestSignInCode<S extends SignInSubject>(
  store: RateLimitStore,
  findSubject: FindSubject<S>,
  params: { email: string; clientKey: string | null },
  deps: { now: Date; mintCode: () => string; onLimiterFailure?: (message: string) => void },
): Promise<RequestResult<S>> {
  // Limited first, before the lookup: a refusal must look the same for a member's email and a
  // stranger's, and cost the same round trip.
  const limit = await takeRateLimit(
    { store, now: deps.now, ...(deps.onLimiterFailure ? { onFailure: deps.onLimiterFailure } : {}) },
    SIGN_IN_REQUEST_LIMIT,
    params.clientKey,
  );
  if (!limit.allowed) return { outcome: "limited", retryAfterMs: limit.retryAfterMs };

  const subject = await findSubject(params.email);
  const code = deps.mintCode();
  const codeHash = hashCode(code);
  return subject ? { outcome: "issue", pending: { subject, code, codeHash } } : { outcome: "skip" };
}

/**
 * Step two, after the response: store the pending code and say whether to send it. Store first, send
 * second, so no code reaches an inbox before it can verify.
 *
 * A still-live code minted within the cooldown is left in place — the subject already has one in
 * their inbox — and this says "skip". The requester never sees the difference.
 */
export async function issueSignInCode(
  store: SignInStore,
  pending: PendingSignInCode<SignInSubject>,
  deps: { now: Date },
): Promise<"deliver" | "skip"> {
  const existing = await store.getSignInCode(pending.subject.id);
  if (
    existing &&
    existing.consumedAt === null &&
    deps.now.getTime() < existing.expiresAt.getTime() &&
    deps.now.getTime() - existing.createdAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    return "skip";
  }
  await store.saveSignInCode({
    subjectId: pending.subject.id,
    codeHash: pending.codeHash,
    createdAt: deps.now,
    expiresAt: new Date(deps.now.getTime() + CODE_TTL_MS),
  });
  return "deliver";
}

/**
 * The only failure a caller ever sees. Wrong code, expired, consumed, none issued, a cap reached,
 * an email with no subject: one value, or the difference is a roster oracle.
 */
export type VerifyResult = { ok: true; subjectId: string } | { ok: false; reason: "invalid" };

const INVALID: VerifyResult = { ok: false, reason: "invalid" };

/**
 * Redeems a presented code: claims a guess first (atomic, so concurrent submits cannot pass the
 * caps together), then checks expiry, then compares the hash, then consumes. A stranger's email
 * claims too, against a null subject, so it costs the same round trip.
 */
export async function verifySignInCode(
  store: SignInStore,
  findSubject: FindSubject<SignInSubject>,
  params: { email: string; code: string },
  deps: { now: Date },
): Promise<VerifyResult> {
  const subject = await findSubject(params.email);
  const presentedHash = hashCode(params.code);
  const claim = await store.claimSignInAttempt(subject?.id ?? null, {
    presentedHash,
    maxAttempts: MAX_ATTEMPTS,
    now: deps.now,
    windowMs: FAILURE_WINDOW_MS,
    maxFailures: MAX_FAILURES_PER_WINDOW,
  });
  if (!claim || !subject) return INVALID;
  if (deps.now.getTime() >= claim.expiresAt.getTime()) return INVALID;
  if (presentedHash !== claim.codeHash) return INVALID;
  // Lost the race: a concurrent submit consumed it first.
  if (!(await store.consumeSignInCode(subject.id, deps.now))) return INVALID;
  return { ok: true, subjectId: subject.id };
}
