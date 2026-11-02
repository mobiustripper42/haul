// Issue 9, AC6–AC8, AC11–AC13 and AC15, and issue 22, AC1, AC4, AC5 and AC7–AC13: the sign-in code
// and link flow, against MemorySignInStore (the folder may not import haul's repository, issue 9
// AC39). Subjects are plain { id, email }; findSubject looks them up the way haul's
// findMemberByEmail does, in any case and ignoring surrounding spaces.
import { beforeEach, describe, expect, it } from "vitest";
import {
  CODE_TTL_MS,
  FAILURE_WINDOW_MS,
  hashCode,
  isLocked,
  issueSignInCode,
  issueSignInLink,
  LINK_TTL_MS,
  MAX_FAILURES_PER_WINDOW,
  randomLinkToken,
  redeemSignInLink,
  requestSignInCode,
  RESEND_COOLDOWN_MS,
  SIGN_IN_REQUEST_LIMIT,
  verifySignInCode,
  type FindSubject,
  type IssueOutcome,
  type PendingSignInCode,
} from "./code.js";
import { MemorySignInStore } from "./memory-store.js";
import type { RateLimitStore, SignInCode, SignInStore, SignInSubject } from "./store.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 14:25:30 UTC: 34 min 30 s left in the clock hour.
const T0 = new Date("2026-10-28T14:25:30.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const plus = (date: Date, ms: number): Date => new Date(date.getTime() + ms);

type Member = SignInSubject & { language: string };
const ADA: Member = { id: "subject-ada", email: "ada@example.com", language: "es" };
const STRANGER = "nobody@example.com";
const INVALID = { ok: false, reason: "invalid" };

let store: MemorySignInStore;
beforeEach(() => {
  store = new MemorySignInStore();
});

const findSubject: FindSubject<Member> = async (email) =>
  email.trim().toLowerCase() === ADA.email ? { ...ADA } : null;

const pendingFor = (subject: SignInSubject, code: string): PendingSignInCode<SignInSubject> => ({
  subject,
  code,
  codeHash: hashCode(code),
});

const NO_LINK = () => "link-token-never-expected";

const issue = (code: string, now: Date, mintLinkToken: () => string = NO_LINK): Promise<IssueOutcome> =>
  issueSignInCode(store, pendingFor(ADA, code), { now, mintLinkToken });
const verify = (code: string, now: Date, email = ADA.email) =>
  verifySignInCode(store, findSubject, { email, code }, { now });

/** Saves a code for Ada straight through the store, with no hold: setup that the code under test never decides. */
const plant = (code: string, createdAt: Date) =>
  store.saveSignInCode({
    subjectId: ADA.id,
    codeHash: hashCode(code),
    createdAt,
    expiresAt: plus(createdAt, CODE_TTL_MS),
  });

const stored = async () => {
  const code = await store.getSignInCode(ADA.id);
  if (!code) throw new Error("no code stored");
  return code;
};

/** The window's first wrong guess, and the guess that brings it to five. */
const WINDOW_START = at(SECOND);
const LAST_CODE_AT = at(10 * MINUTE);
const LOCKED_AT = at(10 * MINUTE + 2 * SECOND);

/**
 * Locks Ada with five wrong guesses spread across two codes: "100000" planted at T0 takes three,
 * "100001" planted at LAST_CODE_AT takes two, the last at LOCKED_AT. "100001" is left live, with
 * two of its attempts spent. Nothing here is asserted, so a test fails on its own expectation.
 */
async function lock(): Promise<void> {
  await plant("100000", T0);
  for (let g = 1; g <= 3; g++) await verify("999999", at(g * SECOND));
  await plant("100001", LAST_CODE_AT);
  await verify("999999", at(10 * MINUTE + SECOND));
  await verify("999999", LOCKED_AT);
}

describe("AC6 (issue 9) — requestSignInCode for a known email", () => {
  it("AC6: returns { outcome: 'issue', pending } with the subject findSubject returned, the minted code and its hash", async () => {
    const result = await requestSignInCode(
      store,
      findSubject,
      { email: "ada@example.com", clientKey: "203.0.113.7" },
      { now: T0, mintCode: () => "042517" },
    );
    expect(result).toEqual({
      outcome: "issue",
      pending: { subject: ADA, code: "042517", codeHash: hashCode("042517") },
    });
  });

  it("AC6: the email reaches findSubject, which matches in any case and with surrounding spaces", async () => {
    const result = await requestSignInCode(
      store,
      findSubject,
      { email: "  ADA@Example.com ", clientKey: "203.0.113.7" },
      { now: T0, mintCode: () => "042517" },
    );
    expect(result).toMatchObject({ outcome: "issue", pending: { subject: ADA } });
  });

  it("AC6: stores no code", async () => {
    await requestSignInCode(
      store,
      findSubject,
      { email: ADA.email, clientKey: "203.0.113.7" },
      { now: T0, mintCode: () => "042517" },
    );
    expect(await store.getSignInCode(ADA.id)).toBeNull();
  });
});

/** A store and a lookup that record, in one list, every call made to either. */
function recorded() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const inner = new MemorySignInStore();
  const recordingStore: SignInStore & RateLimitStore = {
    getSignInCode: (...args) => (calls.push({ name: "getSignInCode", args }), inner.getSignInCode(...args)),
    saveSignInCode: (...args) => (calls.push({ name: "saveSignInCode", args }), inner.saveSignInCode(...args)),
    claimSignInAttempt: (...args) => (calls.push({ name: "claimSignInAttempt", args }), inner.claimSignInAttempt(...args)),
    consumeSignInCode: (...args) => (calls.push({ name: "consumeSignInCode", args }), inner.consumeSignInCode(...args)),
    saveSignInLink: (...args) => (calls.push({ name: "saveSignInLink", args }), inner.saveSignInLink(...args)),
    redeemSignInLink: (...args) => (calls.push({ name: "redeemSignInLink", args }), inner.redeemSignInLink(...args)),
    incrementRateLimit: (...args) => (calls.push({ name: "incrementRateLimit", args }), inner.incrementRateLimit(...args)),
  };
  const lookup: FindSubject<Member> = (email) => (calls.push({ name: "findSubject", args: [email] }), findSubject(email));
  return { calls, inner, store: recordingStore, findSubject: lookup, names: () => calls.map((c) => c.name) };
}

describe("AC7 (issue 9) — requestSignInCode for an unknown email", () => {
  it("AC7: returns { outcome: 'skip' } and stores nothing", async () => {
    const result = await requestSignInCode(
      store,
      findSubject,
      { email: STRANGER, clientKey: "203.0.113.7" },
      { now: T0, mintCode: () => "042517" },
    );
    expect(result).toEqual({ outcome: "skip" });
    expect(await store.getSignInCode(ADA.id)).toBeNull();
  });

  it.each([
    ["a member's email", ADA.email],
    ["a stranger's email", STRANGER],
  ])("AC7: calls mintCode exactly once for %s", async (_who, email) => {
    let minted = 0;
    await requestSignInCode(
      store,
      findSubject,
      { email, clientKey: "203.0.113.7" },
      { now: T0, mintCode: () => (minted++, "042517") },
    );
    expect(minted).toBe(1);
  });

  it("AC7: makes the same calls, in the same order, for a member's email and a stranger's — incrementRateLimit, then findSubject", async () => {
    const member = recorded();
    await requestSignInCode(member.store, member.findSubject, { email: ADA.email, clientKey: "203.0.113.7" }, { now: T0, mintCode: () => "042517" });
    const stranger = recorded();
    await requestSignInCode(stranger.store, stranger.findSubject, { email: STRANGER, clientKey: "203.0.113.7" }, { now: T0, mintCode: () => "042517" });

    expect(member.names()).toEqual(["incrementRateLimit", "findSubject"]);
    expect(stranger.names()).toEqual(member.names());
  });
});

describe("AC8 (issue 9) — requestSignInCode is limited per client key, before the lookup", () => {
  const request = (email: string, clientKey: string | null, s: SignInStore & RateLimitStore = store, lookup: FindSubject<Member> = findSubject) =>
    requestSignInCode(s, lookup, { email, clientKey }, { now: T0, mintCode: () => "042517" });

  it("AC8: SIGN_IN_REQUEST_LIMIT is 20 an hour in the sign-in-request bucket, failing open", () => {
    expect(SIGN_IN_REQUEST_LIMIT).toEqual({ bucket: "sign-in-request", limit: 20, windowMs: HOUR, failOpen: true });
  });

  it.each([
    ["a member's email", ADA.email],
    ["a stranger's email", STRANGER],
  ])("AC8: the 21st request from one client key in a clock hour, for %s, returns limited with the time left in the hour", async (_who, email) => {
    for (let i = 0; i < 20; i++) {
      expect((await request(i % 2 === 0 ? ADA.email : STRANGER, "203.0.113.7")).outcome).not.toBe("limited");
    }
    expect(await request(email, "203.0.113.7")).toEqual({
      outcome: "limited",
      retryAfterMs: 34 * MINUTE + 30 * SECOND,
      refusal: { bucket: "sign-in-request", key: "203.0.113.7", windowStart: new Date("2026-10-28T14:00:00.000Z") },
    });
  });

  it("AC4: the 22nd and 23rd requests in the window are limited with refusal null; the next window's first refusal carries that window", async () => {
    for (let i = 0; i < 21; i++) await request(STRANGER, "203.0.113.7");
    expect(await request(STRANGER, "203.0.113.7")).toEqual({ outcome: "limited", retryAfterMs: 34 * MINUTE + 30 * SECOND, refusal: null });
    expect(await request(ADA.email, "203.0.113.7")).toEqual({ outcome: "limited", retryAfterMs: 34 * MINUTE + 30 * SECOND, refusal: null });

    const next = new Date("2026-10-28T15:05:00.000Z");
    const later = (email: string) =>
      requestSignInCode(store, findSubject, { email, clientKey: "203.0.113.7" }, { now: next, mintCode: () => "042517" });
    for (let i = 0; i < 20; i++) await later(STRANGER);
    expect(await later(STRANGER)).toEqual({
      outcome: "limited",
      retryAfterMs: 55 * MINUTE,
      refusal: { bucket: "sign-in-request", key: "203.0.113.7", windowStart: new Date("2026-10-28T15:00:00.000Z") },
    });
  });

  it("AC8: a limited request does not reach findSubject and stores no code", async () => {
    const r = recorded();
    for (let i = 0; i < 20; i++) await request(STRANGER, "203.0.113.7", r.store, r.findSubject);
    r.calls.length = 0;
    expect((await request(ADA.email, "203.0.113.7", r.store, r.findSubject)).outcome).toBe("limited");
    expect(r.names()).not.toContain("findSubject");
    expect(r.names()).not.toContain("saveSignInCode");
    expect(await r.inner.getSignInCode(ADA.id)).toBeNull();
  });

  it("AC8: a null clientKey is never limited", async () => {
    for (let i = 0; i < 25; i++) {
      expect(await request(ADA.email, null)).toMatchObject({ outcome: "issue" });
    }
  });
});

describe("AC1 — five wrong guesses in a fixed 24-hour window", () => {
  it("AC1: MAX_FAILURES_PER_WINDOW is 5 and FAILURE_WINDOW_MS is 24 hours", () => {
    expect(MAX_FAILURES_PER_WINDOW).toBe(5);
    expect(FAILURE_WINDOW_MS).toBe(DAY);
  });

  it("AC1: the window is fixed from its first wrong guess — once it holds 5, a wrong guess just before its end is refused, and 5 more just after it all count", async () => {
    await plant("100000", T0);
    await verify("999999", WINDOW_START);
    // Four more in the window's last minute, on a fresh code: the window now holds five.
    const lateCode = plus(WINDOW_START, DAY - MINUTE);
    await plant("100001", lateCode);
    for (let g = 1; g <= 4; g++) await verify("999999", plus(lateCode, g * SECOND));
    const full = await stored();
    expect(full).toMatchObject({ attempts: 4, failedSince: WINDOW_START, failedInWindow: 5 });

    // A millisecond before the window ends, it is still full: refused, not even an attempt spent.
    expect(await verify("999999", plus(WINDOW_START, DAY - 1))).toEqual(INVALID);
    expect(await store.getSignInCode(ADA.id)).toEqual(full);

    // From the window's end a new one opens: five more wrong guesses within seconds each claim.
    const nextWindow = plus(WINDOW_START, DAY);
    await plant("100002", nextWindow);
    for (let g = 0; g < 5; g++) await verify("999999", plus(nextWindow, g * SECOND));
    expect(await stored()).toMatchObject({ attempts: 5, failedSince: nextWindow, failedInWindow: 5 });
  });
});

describe("AC9 — issueSignInCode, not locked and outside the wait, stores the code", () => {
  it("AC9: stores the code — createdAt now, expiresAt now + 10 minutes, 0 attempts, unconsumed — and returns { send: 'code' }", async () => {
    expect(await issue("042517", T0)).toEqual({ send: "code" });
    expect(await stored()).toMatchObject({
      subjectId: ADA.id,
      codeHash: hashCode("042517"),
      createdAt: T0,
      expiresAt: at(10 * MINUTE),
      attempts: 0,
      consumedAt: null,
    });
    expect(CODE_TTL_MS).toBe(10 * MINUTE);
  });

  it("AC9: the stored code verifies", async () => {
    await issue("042517", T0);
    expect(await verify("042517", at(MINUTE))).toEqual({ ok: true, subjectId: ADA.id });
  });

  it("AC9: a later code, outside the wait, replaces the one before, which no longer verifies", async () => {
    await issue("111111", T0);
    expect(await issue("222222", at(10 * MINUTE))).toEqual({ send: "code" });
    expect(await verify("111111", at(10 * MINUTE + SECOND))).toEqual(INVALID);
    expect(await verify("222222", at(10 * MINUTE + 2 * SECOND))).toEqual({ ok: true, subjectId: ADA.id });
  });

  it("AC9: a member with wrong guesses in the window but fewer than five still gets a code", async () => {
    await plant("100000", T0);
    for (let g = 1; g <= 4; g++) await verify("999999", at(g * SECOND));
    expect(await issue("424242", at(10 * MINUTE))).toEqual({ send: "code" });
    expect((await stored()).codeHash).toBe(hashCode("424242"));
  });
});

describe("AC7 — one sign-in email per member per 10 minutes, held in the store's save", () => {
  it("AC7: RESEND_COOLDOWN_MS is CODE_TTL_MS, 10 minutes", () => {
    expect(RESEND_COOLDOWN_MS).toBe(CODE_TTL_MS);
    expect(RESEND_COOLDOWN_MS).toBe(10 * MINUTE);
  });

  it("AC7: within 10 minutes of an unused code it stores nothing and returns { send: 'nothing' }, and the existing code still verifies", async () => {
    await issue("111111", T0);
    const before = await stored();
    expect(await issue("222222", at(10 * MINUTE - 1))).toEqual({ send: "nothing" });
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
    expect(await verify("111111", at(10 * MINUTE - 1))).toEqual({ ok: true, subjectId: ADA.id });
  });

  it("AC7: at exactly 10 minutes it sends again — the new code is stored", async () => {
    await issue("111111", T0);
    expect(await issue("222222", at(10 * MINUTE))).toEqual({ send: "code" });
    expect((await stored()).codeHash).toBe(hashCode("222222"));
  });

  it("AC7: a consumed code does not hold off a new one, even within 10 minutes", async () => {
    await issue("111111", T0);
    expect(await verify("111111", at(10 * SECOND))).toEqual({ ok: true, subjectId: ADA.id });
    expect(await issue("222222", at(20 * SECOND))).toEqual({ send: "code" });
    expect(await verify("222222", at(30 * SECOND))).toEqual({ ok: true, subjectId: ADA.id });
  });

  it("AC7: an unused code holds however many of its attempts are spent — every one claimed and none consumed", async () => {
    await issue("111111", T0);
    const right = { presentedHash: hashCode("111111"), maxAttempts: 5, windowMs: DAY, maxFailures: 5 };
    for (let g = 1; g <= 5; g++) await store.claimSignInAttempt(ADA.id, { ...right, now: at(g * SECOND) });
    const before = await stored();
    expect(before).toMatchObject({ attempts: 5, consumedAt: null });
    expect(await issue("222222", at(9 * MINUTE))).toEqual({ send: "nothing" });
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
  });

  it("AC7: a locked member inside the wait gets nothing — no code, no link", async () => {
    await lock();
    const before = await stored();
    expect(await issue("424242", at(15 * MINUTE), () => "tok-held")).toEqual({ send: "nothing" });
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
  });

  it("AC7: the outcome follows the store's save — a save that holds gives { send: 'nothing' }, whatever a read before it showed", async () => {
    const inner = new MemorySignInStore();
    const holding: SignInStore = {
      getSignInCode: async () => null,
      saveSignInCode: async () => false,
      claimSignInAttempt: (...args) => inner.claimSignInAttempt(...args),
      consumeSignInCode: (...args) => inner.consumeSignInCode(...args),
      saveSignInLink: async () => false,
      redeemSignInLink: (...args) => inner.redeemSignInLink(...args),
    };
    expect(await issueSignInCode(holding, pendingFor(ADA, "042517"), { now: T0, mintLinkToken: NO_LINK })).toEqual({
      send: "nothing",
    });
  });

  it("AC7: 10 requests that arrive together store one code and return { send: 'code' } exactly once", async () => {
    const codes = Array.from({ length: 10 }, (_, i) => String(300000 + i));
    const outcomes = await Promise.all(codes.map((code) => issue(code, T0)));
    const sent = outcomes.flatMap((outcome, i) => (outcome.send === "code" ? [codes[i]] : []));
    expect(sent).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.send === "nothing")).toHaveLength(9);
    expect((await stored()).codeHash).toBe(hashCode(sent[0] ?? "none sent"));
  });
});

describe("AC8 — while locked and outside the wait, issueSignInCode sends a link instead", () => {
  const code = (over: Partial<SignInCode>): SignInCode => ({
    subjectId: ADA.id,
    codeHash: hashCode("100000"),
    createdAt: T0,
    expiresAt: at(10 * MINUTE),
    attempts: 0,
    consumedAt: null,
    failedSince: null,
    failedInWindow: 0,
    linkHash: null,
    linkCreatedAt: null,
    linkExpiresAt: null,
    ...over,
  });
  const rule = (now: Date) => ({ now, windowMs: DAY, maxFailures: 5 });

  it("AC8: isLocked is true while the window is live and failedInWindow is at or past maxFailures", () => {
    expect(isLocked(code({ failedSince: T0, failedInWindow: 5 }), rule(at(HOUR)))).toBe(true);
    expect(isLocked(code({ failedSince: T0, failedInWindow: 6 }), rule(at(HOUR)))).toBe(true);
    expect(isLocked(code({ failedSince: T0, failedInWindow: 5 }), rule(at(DAY - 1)))).toBe(true);
  });

  it("AC8: isLocked is false below maxFailures, with no window, and from failedSince + windowMs on", () => {
    expect(isLocked(code({ failedSince: T0, failedInWindow: 4 }), rule(at(HOUR)))).toBe(false);
    expect(isLocked(code({ failedSince: null, failedInWindow: 5 }), rule(at(HOUR)))).toBe(false);
    expect(isLocked(code({ failedSince: T0, failedInWindow: 5 }), rule(at(DAY)))).toBe(false);
  });

  it("AC8: returns { send: 'link', token } with the minted token, stores no code, and saves the link's hash for 10 minutes", async () => {
    await lock();
    const before = await stored();
    const now = at(20 * MINUTE);
    expect(await issue("424242", now, () => "tok-locked")).toEqual({ send: "link", token: "tok-locked" });
    expect(await store.getSignInCode(ADA.id)).toEqual({
      ...before,
      linkHash: hashCode("tok-locked"),
      linkCreatedAt: now,
      linkExpiresAt: plus(now, 10 * MINUTE),
    });
  });

  it("AC8: the code it did not store does not verify, and the link it sent redeems", async () => {
    await lock();
    await issue("424242", at(20 * MINUTE), () => "tok-locked");
    expect(await verify("424242", at(21 * MINUTE))).toEqual(INVALID);
    expect(await redeemSignInLink(store, "tok-locked", { now: at(21 * MINUTE) })).toEqual({ ok: true, subjectId: ADA.id });
  });
});

describe("AC10 — the locking guess's link is not held by the wait, and starts it", () => {
  it("AC10: issueSignInLink with no hold saves a link 2 seconds after a code went", async () => {
    await lock();
    expect(await issueSignInLink(store, ADA, { now: LOCKED_AT, mintLinkToken: () => "tok-lock", hold: false })).toBe(
      "tok-lock",
    );
    expect(await stored()).toMatchObject({ linkHash: hashCode("tok-lock"), linkCreatedAt: LOCKED_AT });
  });

  it("AC10: that link starts the wait — a request a millisecond short of 10 minutes after it gets nothing, one at 10 minutes a fresh link", async () => {
    await lock();
    await issueSignInLink(store, ADA, { now: LOCKED_AT, mintLinkToken: () => "tok-lock", hold: false });
    // By now the last code is more than 10 minutes old; only the link holds.
    expect(await issue("424242", plus(LOCKED_AT, 10 * MINUTE - 1), () => "tok-early")).toEqual({ send: "nothing" });
    expect((await stored()).linkHash).toBe(hashCode("tok-lock"));
    expect(await issue("424242", plus(LOCKED_AT, 10 * MINUTE), () => "tok-next")).toEqual({
      send: "link",
      token: "tok-next",
    });
  });
});

describe("AC11 — issueSignInLink mints, hashes and stores a 10-minute link", () => {
  it("AC11: LINK_TTL_MS is CODE_TTL_MS", () => {
    expect(LINK_TTL_MS).toBe(CODE_TTL_MS);
  });

  it("AC11: returns the minted token and stores its hash, with createdAt now and expiresAt now + 10 minutes, leaving the code as it was", async () => {
    await plant("100000", T0);
    const before = await stored();
    const now = at(MINUTE);
    expect(await issueSignInLink(store, ADA, { now, mintLinkToken: () => "tok-1", hold: false })).toBe("tok-1");
    expect(await store.getSignInCode(ADA.id)).toEqual({
      ...before,
      linkHash: hashCode("tok-1"),
      linkCreatedAt: now,
      linkExpiresAt: plus(now, 10 * MINUTE),
    });
  });

  it("AC11: a new link replaces the earlier one", async () => {
    await plant("100000", T0);
    await issueSignInLink(store, ADA, { now: at(MINUTE), mintLinkToken: () => "tok-1", hold: false });
    await issueSignInLink(store, ADA, { now: at(2 * MINUTE), mintLinkToken: () => "tok-2", hold: false });
    expect(await stored()).toMatchObject({ linkHash: hashCode("tok-2"), linkCreatedAt: at(2 * MINUTE) });
  });

  it("AC11: with the hold, outside the wait, it saves", async () => {
    await plant("100000", T0);
    expect(await issueSignInLink(store, ADA, { now: at(10 * MINUTE), mintLinkToken: () => "tok-1", hold: true })).toBe(
      "tok-1",
    );
    expect((await stored()).linkHash).toBe(hashCode("tok-1"));
  });

  it("AC11: held by the wait, it returns null and stores nothing", async () => {
    await plant("100000", T0);
    const before = await stored();
    expect(await issueSignInLink(store, ADA, { now: at(MINUTE), mintLinkToken: () => "tok-1", hold: true })).toBeNull();
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
  });

  it("AC11: for a subject with no sign-in row it returns null and stores nothing", async () => {
    expect(await issueSignInLink(store, ADA, { now: T0, mintLinkToken: () => "tok-1", hold: false })).toBeNull();
    expect(await store.getSignInCode(ADA.id)).toBeNull();
  });

  it("AC11: randomLinkToken() is 32 random bytes in base64url — 43 characters, no padding, a new one each call", () => {
    const tokens = Array.from({ length: 20 }, () => randomLinkToken());
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("AC12 — redeemSignInLink is single use and lasts 10 minutes", () => {
  /** Ada's code planted at T0 and a link for "tok-1" saved at T0, expiring at T0 + 10 minutes. */
  const withLink = async () => {
    await plant("100000", T0);
    await issueSignInLink(store, ADA, { now: T0, mintLinkToken: () => "tok-1", hold: false });
  };

  it("AC12: the live link's token returns { ok: true, subjectId } once; a second redeem returns { ok: false } and changes nothing", async () => {
    await withLink();
    expect(await redeemSignInLink(store, "tok-1", { now: at(MINUTE) })).toEqual({ ok: true, subjectId: ADA.id });
    const after = await stored();
    expect(await redeemSignInLink(store, "tok-1", { now: at(2 * MINUTE) })).toEqual({ ok: false });
    expect(await store.getSignInCode(ADA.id)).toEqual(after);
  });

  it("AC12: a millisecond before expiresAt it still redeems", async () => {
    await withLink();
    expect(await redeemSignInLink(store, "tok-1", { now: at(10 * MINUTE - 1) })).toEqual({ ok: true, subjectId: ADA.id });
  });

  it.each([
    ["at expiresAt", "tok-1", 10 * MINUTE],
    ["after expiresAt", "tok-1", 11 * MINUTE],
    ["an unknown token", "tok-unknown", MINUTE],
    ["an empty token", "", MINUTE],
  ])("AC12: %s returns { ok: false } and changes nothing", async (_what, token, ms) => {
    await withLink();
    const before = await stored();
    expect(await redeemSignInLink(store, token, { now: at(ms) })).toEqual({ ok: false });
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
  });

  it("AC12: a replaced link's token returns { ok: false } and changes nothing; the new one redeems", async () => {
    await withLink();
    await issueSignInLink(store, ADA, { now: at(MINUTE), mintLinkToken: () => "tok-2", hold: false });
    const before = await stored();
    expect(await redeemSignInLink(store, "tok-1", { now: at(2 * MINUTE) })).toEqual({ ok: false });
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
    expect(await redeemSignInLink(store, "tok-2", { now: at(2 * MINUTE) })).toEqual({ ok: true, subjectId: ADA.id });
  });
});

describe("AC13 — a redeemed link clears the lock and consumes the code", () => {
  it("AC13: after the redeem the window is clear, the code consumed and the link gone", async () => {
    await lock();
    await issue("424242", at(20 * MINUTE), () => "tok-locked");
    expect(await redeemSignInLink(store, "tok-locked", { now: at(21 * MINUTE) })).toEqual({ ok: true, subjectId: ADA.id });
    expect(await stored()).toMatchObject({
      failedSince: null,
      failedInWindow: 0,
      consumedAt: at(21 * MINUTE),
      linkHash: null,
      linkCreatedAt: null,
      linkExpiresAt: null,
    });
  });

  it("AC13: the code still live at the redeem no longer verifies, and the member's next code does", async () => {
    await lock();
    await issueSignInLink(store, ADA, { now: LOCKED_AT, mintLinkToken: () => "tok-lock", hold: false });
    const redeemedAt = plus(LOCKED_AT, MINUTE);
    expect(await redeemSignInLink(store, "tok-lock", { now: redeemedAt })).toEqual({ ok: true, subjectId: ADA.id });
    // "100001" lives until LAST_CODE_AT + 10 minutes with attempts to spare; with the window cleared,
    // only its consumption stops it.
    expect(await verify("100001", plus(redeemedAt, SECOND))).toEqual(INVALID);
    expect(await issue("777777", plus(redeemedAt, 2 * SECOND))).toEqual({ send: "code" });
    expect(await verify("777777", plus(redeemedAt, 3 * SECOND))).toEqual({ ok: true, subjectId: ADA.id });
  });
});

describe("AC11 (issue 9) — verifySignInCode succeeds once", () => {
  it("AC11: a member's email and their code before expiresAt returns { ok: true, subjectId }", async () => {
    await issue("042517", T0);
    expect(await verify("042517", at(10 * MINUTE - 1))).toEqual({ ok: true, subjectId: ADA.id });
  });

  it("AC11: the email matches in any case and with surrounding spaces", async () => {
    await issue("042517", T0);
    expect(await verify("042517", at(MINUTE), "  ADA@Example.COM ")).toEqual({ ok: true, subjectId: ADA.id });
  });

  it("AC11: it consumes the code — the same code again returns invalid", async () => {
    await issue("042517", T0);
    expect(await verify("042517", at(MINUTE))).toEqual({ ok: true, subjectId: ADA.id });
    expect(await verify("042517", at(2 * MINUTE))).toEqual(INVALID);
  });
});

describe("AC12 (issue 9) — every failure is the one value { ok: false, reason: 'invalid' }", () => {
  it("AC12: a wrong code", async () => {
    await issue("042517", T0);
    expect(await verify("042518", at(MINUTE))).toEqual(INVALID);
  });

  it("AC12: the right code at expiresAt", async () => {
    await issue("042517", T0);
    expect(await verify("042517", at(10 * MINUTE))).toEqual(INVALID);
  });

  it("AC12: the right code after expiresAt", async () => {
    await issue("042517", T0);
    expect(await verify("042517", at(11 * MINUTE))).toEqual(INVALID);
  });

  it("AC12: a consumed code", async () => {
    await issue("042517", T0);
    await verify("042517", at(MINUTE));
    expect(await verify("042517", at(2 * MINUTE))).toEqual(INVALID);
  });

  it("AC12: no code issued", async () => {
    expect(await verify("042517", at(MINUTE))).toEqual(INVALID);
  });

  it("AC12: a code at its attempt cap", async () => {
    await issue("042517", T0);
    for (let g = 0; g < 5; g++) await verify("999999", at((g + 1) * SECOND));
    expect(await verify("042517", at(10 * SECOND))).toEqual(INVALID);
  });

  it("AC12: a wrong guess at the failure-window cap", async () => {
    await lock();
    expect(await verify("999999", at(10 * MINUTE + 3 * SECOND))).toEqual(INVALID);
  });

  it("AC12: an email with no member", async () => {
    await issue("042517", T0);
    expect(await verify("042517", at(MINUTE), STRANGER)).toEqual(INVALID);
  });
});

describe("AC13 (issue 9) — five guesses per code", () => {
  it("AC13: after 4 wrong guesses the right code still succeeds", async () => {
    await issue("042517", T0);
    for (let g = 0; g < 4; g++) expect(await verify("999999", at((g + 1) * SECOND))).toEqual(INVALID);
    expect(await verify("042517", at(10 * SECOND))).toEqual({ ok: true, subjectId: ADA.id });
  });

  it("AC13: after 5 wrong guesses the right code returns invalid", async () => {
    await issue("042517", T0);
    for (let g = 0; g < 4; g++) expect(await verify("999999", at((g + 1) * SECOND))).toEqual(INVALID);
    // The fifth is also the window's fifth, so it carries lockedNow; AC5 (issue 22) proves that.
    expect(await verify("999999", at(5 * SECOND))).toMatchObject(INVALID);
    expect(await verify("042517", at(10 * SECOND))).toEqual(INVALID);
  });

  it("AC13: a guess at an expired code uses one of the 5", async () => {
    await issue("042517", T0);
    expect(await verify("042517", at(11 * MINUTE))).toEqual(INVALID);
    expect((await stored()).attempts).toBe(1);
    expect(await verify("999999", at(12 * MINUTE))).toEqual(INVALID);
    expect((await stored()).attempts).toBe(2);
  });
});

// Replaces issue 9's AC14 (fifty a day, the right code still let through at the cap).
describe("AC4 — five wrong guesses in a window lock code sign-in, the right code included", () => {
  it("AC4: after 5 wrong guesses across two codes, the right code of the live one returns invalid", async () => {
    await lock();
    expect(await verify("100001", at(10 * MINUTE + 3 * SECOND))).toEqual(INVALID);
  });

  it("AC4: after 5 wrong guesses on one code, a fresh code with every attempt left is refused for its right code, and nothing changes", async () => {
    await plant("100000", T0);
    for (let g = 1; g <= 5; g++) await verify("999999", at(g * SECOND));
    await plant("424242", at(MINUTE));
    const before = await stored();
    expect(before).toMatchObject({ attempts: 0, failedInWindow: 5 });
    expect(await verify("424242", at(MINUTE + SECOND))).toEqual(INVALID);
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
  });

  it("AC4: a further wrong guess returns invalid and changes nothing, not even the code's attempts", async () => {
    await lock();
    const before = await stored();
    expect(before).toMatchObject({ attempts: 2, failedInWindow: 5 });
    expect(await verify("999999", at(10 * MINUTE + 3 * SECOND))).toEqual(INVALID);
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
  });

  it("AC4: a millisecond before 24 hours from the window's first wrong guess, a fresh code is still refused, right or wrong", async () => {
    await lock();
    const justBefore = plus(WINDOW_START, DAY - 1);
    await plant("424242", plus(justBefore, -MINUTE));
    const before = await stored();
    expect(await verify("424242", justBefore)).toEqual(INVALID);
    expect(await verify("999999", justBefore)).toEqual(INVALID);
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
  });

  it("AC4: at 24 hours from the window's first wrong guess the lock is over — a fresh code is sent, and it verifies", async () => {
    await lock();
    const dayLater = plus(WINDOW_START, DAY);
    expect(await issue("424242", dayLater)).toEqual({ send: "code" });
    expect(await verify("424242", plus(dayLater, SECOND))).toEqual({ ok: true, subjectId: ADA.id });
  });

  it("AC4: the first wrong guess 24 hours or more after the window's first opens a new window at 1", async () => {
    await lock();
    const dayLater = plus(WINDOW_START, DAY);
    await plant("424242", plus(dayLater, -MINUTE));
    expect(await verify("999999", dayLater)).toEqual(INVALID);
    expect(await stored()).toMatchObject({ attempts: 1, failedSince: dayLater, failedInWindow: 1 });
  });
});

describe("AC5 — the guess that locks, and only it, reports lockedNow", () => {
  const LOCKED_NOW = { ok: false, reason: "invalid", lockedNow: ADA };

  it("AC5: the 5th wrong guess in the window, across two codes, returns lockedNow: the subject findSubject found; the four before it don't", async () => {
    await plant("100000", T0);
    for (let g = 1; g <= 3; g++) expect(await verify("999999", at(g * SECOND))).toEqual(INVALID);
    await plant("100001", LAST_CODE_AT);
    expect(await verify("999999", at(10 * MINUTE + SECOND))).toEqual(INVALID);
    expect(await verify("999999", LOCKED_AT)).toEqual(LOCKED_NOW);
  });

  it("AC5: the locking wrong guess on an expired code still carries it — decided before the expiry check", async () => {
    await plant("100000", T0);
    for (let g = 1; g <= 4; g++) expect(await verify("999999", at(g * SECOND))).toEqual(INVALID);
    expect(await verify("999999", at(11 * MINUTE))).toEqual(LOCKED_NOW);
  });

  it("AC5: the refused guesses after the lock, wrong or right, carry none", async () => {
    await lock();
    expect(await verify("999999", at(10 * MINUTE + 3 * SECOND))).toEqual(INVALID);
    expect(await verify("100001", at(10 * MINUTE + 4 * SECOND))).toEqual(INVALID);
  });

  it("AC5: a right but expired code in a lapsed window whose count still reads 5 carries none", async () => {
    await lock();
    const later = plus(WINDOW_START, DAY + MINUTE);
    await plant("424242", later);
    expect(await verify("424242", plus(later, 11 * MINUTE))).toEqual(INVALID);
    expect((await stored()).failedInWindow).toBe(5);
  });

  it("AC5: a stranger's five wrong guesses carry none", async () => {
    await plant("100000", T0);
    for (let g = 1; g <= 5; g++) expect(await verify("999999", at(g * SECOND), STRANGER)).toEqual(INVALID);
  });
});

describe("AC15 (issue 9) — verify makes the same calls for a member and a stranger", () => {
  it.each([
    ["a member with a live code, guessing wrong", true],
    ["a member with no code", false],
  ])("AC15: %s and a stranger both call findSubject, then claimSignInAttempt — nothing else", async (_who, withCode) => {
    const member = recorded();
    if (withCode) await issueSignInCode(member.inner, pendingFor(ADA, "042517"), { now: T0, mintLinkToken: NO_LINK });
    await verifySignInCode(member.store, member.findSubject, { email: ADA.email, code: "999999" }, { now: at(MINUTE) });
    const stranger = recorded();
    await verifySignInCode(stranger.store, stranger.findSubject, { email: STRANGER, code: "999999" }, { now: at(MINUTE) });

    expect(member.names()).toEqual(["findSubject", "claimSignInAttempt"]);
    expect(stranger.names()).toEqual(member.names());
  });

  it("AC15: a stranger's claim passes null as the subject id, and changes nothing", async () => {
    const r = recorded();
    await issueSignInCode(r.inner, pendingFor(ADA, "042517"), { now: T0, mintLinkToken: NO_LINK });
    const before = await r.inner.getSignInCode(ADA.id);
    await verifySignInCode(r.store, r.findSubject, { email: STRANGER, code: "042517" }, { now: at(MINUTE) });
    const claim = r.calls.find((c) => c.name === "claimSignInAttempt");
    expect(claim?.args[0]).toBeNull();
    expect(await r.inner.getSignInCode(ADA.id)).toEqual(before);
  });
});
