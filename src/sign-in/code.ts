import { createHash, randomBytes, randomInt } from "node:crypto";
import { takeRateLimit, type RateLimitPolicy } from "./rate-limit.js";
import type { RateLimitStore, SignInCode, SignInStore, SignInSubject } from "./store.js";

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
/** One sign-in email per member per this long, held in the store's save. */
export const RESEND_COOLDOWN_MS = CODE_TTL_MS;
export const FAILURE_WINDOW_MS = 24 * 60 * 60_000;
export const MAX_FAILURES_PER_WINDOW = 5;
export const LINK_TTL_MS = CODE_TTL_MS;

export type IssueOutcome = { send: "code" } | { send: "link"; token: string } | { send: "nothing" };

/** The one TypeScript home for "the window is live": `failedSince` is set and `now < failedSince + windowMs`. */
export function isWindowLive(code: Pick<SignInCode, "failedSince">, rule: { now: Date; windowMs: number }): boolean {
  return code.failedSince !== null && rule.now.getTime() < code.failedSince.getTime() + rule.windowMs;
}

/** Locked: the window is live and has taken `maxFailures` wrong guesses. Code sign-in is refused, the right code included. */
export function isLocked(code: SignInCode, rule: { now: Date; windowMs: number; maxFailures: number }): boolean {
  return isWindowLive(code, rule) && code.failedInWindow >= rule.maxFailures;
}

export function randomLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

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
 * Mints a link, hashes it and stores it for `LINK_TTL_MS`, replacing any earlier one. With `hold` the
 * store saves only outside the sign-in email wait. Null when nothing was saved: a subject with no
 * sign-in row, or held. The one home for minting and saving a link.
 */
export async function issueSignInLink(
  store: SignInStore,
  subject: SignInSubject,
  deps: { now: Date; mintLinkToken: () => string; hold: boolean },
): Promise<string | null> {
  const token = deps.mintLinkToken();
  const saved = await store.saveSignInLink(
    {
      subjectId: subject.id,
      linkHash: hashCode(token),
      createdAt: deps.now,
      expiresAt: new Date(deps.now.getTime() + LINK_TTL_MS),
    },
    deps.hold ? { now: deps.now, waitMs: RESEND_COOLDOWN_MS } : undefined,
  );
  return saved ? token : null;
}

/**
 * Step two, after the response: store what is to be sent and say which email goes. Store first, send
 * second, so nothing reaches an inbox before it can work.
 *
 * A member locked out gets a link instead of a code, and a member who was sent a code or a link in
 * the last `RESEND_COOLDOWN_MS` gets nothing. The wait is decided inside the store's save, in the
 * same atomic step as the write, so requests that arrive together send one email. The requester
 * never sees the difference.
 */
export async function issueSignInCode(
  store: SignInStore,
  pending: PendingSignInCode<SignInSubject>,
  deps: { now: Date; mintLinkToken: () => string },
): Promise<IssueOutcome> {
  const existing = await store.getSignInCode(pending.subject.id);
  if (existing && isLocked(existing, { now: deps.now, windowMs: FAILURE_WINDOW_MS, maxFailures: MAX_FAILURES_PER_WINDOW })) {
    const token = await issueSignInLink(store, pending.subject, { ...deps, hold: true });
    return token === null ? { send: "nothing" } : { send: "link", token };
  }
  const saved = await store.saveSignInCode(
    {
      subjectId: pending.subject.id,
      codeHash: pending.codeHash,
      createdAt: deps.now,
      expiresAt: new Date(deps.now.getTime() + CODE_TTL_MS),
    },
    { now: deps.now, waitMs: RESEND_COOLDOWN_MS },
  );
  return saved ? { send: "code" } : { send: "nothing" };
}

/**
 * Redeems a sign-in link's token: single use, and for `LINK_TTL_MS`. A redeem clears the member's
 * wrong-guess window and consumes their code, in one atomic step in the store.
 */
export async function redeemSignInLink(
  store: SignInStore,
  token: string,
  deps: { now: Date },
): Promise<{ ok: true; subjectId: string } | { ok: false }> {
  const subjectId = await store.redeemSignInLink(hashCode(token), deps.now);
  return subjectId === null ? { ok: false } : { ok: true, subjectId };
}

/**
 * The only failure a caller ever sees. Wrong code, expired, consumed, none issued, a cap reached,
 * locked, an email with no subject: one value, or the difference is a roster oracle.
 *
 * `lockedNow` is the exception, for the server action alone: it names the subject whose wrong guess
 * just locked code sign-in, so the action can email them a link after the response. It never reaches
 * a response.
 */
export type VerifyResult<S extends SignInSubject> =
  | { ok: true; subjectId: string }
  | { ok: false; reason: "invalid"; lockedNow?: S };

const INVALID = { ok: false, reason: "invalid" } as const;

/**
 * Redeems a presented code: claims a guess first (atomic, so concurrent submits cannot pass the
 * caps together), then compares the hash, then checks expiry, then consumes. A stranger's email
 * claims too, against a null subject, so it costs the same round trip.
 *
 * The wrong guess that brings the window to `MAX_FAILURES_PER_WINDOW` reports `lockedNow`, decided
 * before the expiry check: no other result carries it.
 */
export async function verifySignInCode<S extends SignInSubject>(
  store: SignInStore,
  findSubject: FindSubject<S>,
  params: { email: string; code: string },
  deps: { now: Date },
): Promise<VerifyResult<S>> {
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
  if (presentedHash !== claim.codeHash) {
    return claim.failedInWindow === MAX_FAILURES_PER_WINDOW ? { ...INVALID, lockedNow: subject } : INVALID;
  }
  if (deps.now.getTime() >= claim.expiresAt.getTime()) return INVALID;
  // Lost the race: a concurrent submit consumed it first.
  if (!(await store.consumeSignInCode(subject.id, deps.now))) return INVALID;
  return { ok: true, subjectId: subject.id };
}
