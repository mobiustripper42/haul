// Issue 9, AC6–AC9 and AC11–AC15: the sign-in code flow, against MemorySignInStore (the folder
// may not import haul's repository, AC39). Subjects are plain { id, email }; findSubject looks
// them up the way haul's findMemberByEmail does, in any case and ignoring surrounding spaces.
import { beforeEach, describe, expect, it } from "vitest";
import {
  CODE_TTL_MS,
  hashCode,
  issueSignInCode,
  requestSignInCode,
  SIGN_IN_REQUEST_LIMIT,
  verifySignInCode,
  type FindSubject,
  type PendingSignInCode,
} from "./code.js";
import { MemorySignInStore } from "./memory-store.js";
import type { RateLimitStore, SignInStore, SignInSubject } from "./store.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 14:25:30 UTC: 34 min 30 s left in the clock hour.
const T0 = new Date("2026-10-28T14:25:30.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);

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

const issue = (code: string, now: Date) => issueSignInCode(store, pendingFor(ADA, code), { now });
const verify = (code: string, now: Date, email = ADA.email) =>
  verifySignInCode(store, findSubject, { email, code }, { now });

const stored = async () => {
  const code = await store.getSignInCode(ADA.id);
  if (!code) throw new Error("no code stored");
  return code;
};

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
    expect(await request(email, "203.0.113.7")).toEqual({ outcome: "limited", retryAfterMs: 34 * MINUTE + 30 * SECOND });
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

describe("AC9 (issue 9) — issueSignInCode", () => {
  it("AC9: stores the code — createdAt now, expiresAt now + 10 minutes, 0 attempts, unconsumed — and returns 'deliver'", async () => {
    expect(await issue("042517", T0)).toBe("deliver");
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

  it("AC9: a later code replaces the one before, which no longer verifies", async () => {
    await issue("111111", T0);
    expect(await issue("222222", at(61 * SECOND))).toBe("deliver");
    expect(await verify("111111", at(62 * SECOND))).toEqual(INVALID);
    expect(await verify("222222", at(63 * SECOND))).toEqual({ ok: true, subjectId: ADA.id });
  });

  it("AC9: within 60 seconds of an unconsumed, unexpired code it stores nothing and returns 'skip', and the existing code still verifies", async () => {
    await issue("111111", T0);
    const before = await stored();
    expect(await issue("222222", at(59 * SECOND))).toBe("skip");
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
    expect(await verify("111111", at(59 * SECOND))).toEqual({ ok: true, subjectId: ADA.id });
  });

  it("AC9: at exactly 60 seconds the existing code is no longer within the cooldown — the new one is stored", async () => {
    await issue("111111", T0);
    expect(await issue("222222", at(60 * SECOND))).toBe("deliver");
    expect((await stored()).codeHash).toBe(hashCode("222222"));
  });

  it("AC9: a consumed code does not hold off a new one, even within 60 seconds", async () => {
    await issue("111111", T0);
    expect(await verify("111111", at(10 * SECOND))).toEqual({ ok: true, subjectId: ADA.id });
    expect(await issue("222222", at(20 * SECOND))).toBe("deliver");
    expect(await verify("222222", at(30 * SECOND))).toEqual({ ok: true, subjectId: ADA.id });
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

/** 50 wrong guesses across ten codes, five each, all inside one window opened at T0 + 1 s. */
async function burnWindow(): Promise<void> {
  for (let n = 0; n < 10; n++) {
    const issuedAt = at(n * 2 * MINUTE);
    expect(await issue(String(100000 + n), issuedAt)).toBe("deliver");
    for (let g = 0; g < 5; g++) {
      expect(await verify("999999", new Date(issuedAt.getTime() + (g + 1) * SECOND))).toEqual(INVALID);
    }
  }
  expect(await stored()).toMatchObject({ failedSince: at(SECOND), failedInWindow: 50 });
}

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
    await burnWindow();
    await issue("424242", at(30 * MINUTE));
    expect(await verify("999999", at(31 * MINUTE))).toEqual(INVALID);
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
    for (let g = 0; g < 5; g++) expect(await verify("999999", at((g + 1) * SECOND))).toEqual(INVALID);
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

describe("AC14 (issue 9) — fifty wrong guesses a day per member", () => {
  it("AC14: the 50th wrong guess within 24 hours counts; a further wrong guess returns invalid and changes nothing, not even the code's attempts", async () => {
    await burnWindow();
    await issue("424242", at(30 * MINUTE));
    const before = await stored();
    expect(before).toMatchObject({ attempts: 0, failedInWindow: 50 });
    expect(await verify("999999", at(31 * MINUTE))).toEqual(INVALID);
    expect(await store.getSignInCode(ADA.id)).toEqual(before);
  });

  it("AC14: the right code still succeeds at the cap, and does not add to the window", async () => {
    await burnWindow();
    await issue("424242", at(30 * MINUTE));
    expect(await verify("424242", at(31 * MINUTE))).toEqual({ ok: true, subjectId: ADA.id });
    expect(await stored()).toMatchObject({ failedSince: at(SECOND), failedInWindow: 50 });
  });

  it("AC14: a new code does not reset the window", async () => {
    await burnWindow();
    expect(await issue("424242", at(30 * MINUTE))).toBe("deliver");
    expect(await stored()).toMatchObject({ failedSince: at(SECOND), failedInWindow: 50 });
    expect(await verify("999999", at(31 * MINUTE))).toEqual(INVALID);
    expect((await stored()).attempts).toBe(0);
  });

  it("AC14: a wrong guess a millisecond before 24 hours from the window's first is still refused at the cap", async () => {
    await burnWindow();
    const justBefore = at(SECOND + DAY - 1);
    await issue("424242", new Date(justBefore.getTime() - MINUTE));
    expect(await verify("999999", justBefore)).toEqual(INVALID);
    expect(await stored()).toMatchObject({ attempts: 0, failedSince: at(SECOND), failedInWindow: 50 });
  });

  it("AC14: the first wrong guess 24 hours or more after the window's first starts a new window at 1", async () => {
    await burnWindow();
    const dayLater = at(SECOND + DAY);
    await issue("424242", new Date(dayLater.getTime() - MINUTE));
    expect(await verify("999999", dayLater)).toEqual(INVALID);
    expect(await stored()).toMatchObject({ attempts: 1, failedSince: dayLater, failedInWindow: 1 });
  });
});

describe("AC15 (issue 9) — verify makes the same calls for a member and a stranger", () => {
  it.each([
    ["a member with a live code, guessing wrong", true],
    ["a member with no code", false],
  ])("AC15: %s and a stranger both call findSubject, then claimSignInAttempt — nothing else", async (_who, withCode) => {
    const member = recorded();
    if (withCode) await issueSignInCode(member.inner, pendingFor(ADA, "042517"), { now: T0 });
    await verifySignInCode(member.store, member.findSubject, { email: ADA.email, code: "999999" }, { now: at(MINUTE) });
    const stranger = recorded();
    await verifySignInCode(stranger.store, stranger.findSubject, { email: STRANGER, code: "999999" }, { now: at(MINUTE) });

    expect(member.names()).toEqual(["findSubject", "claimSignInAttempt"]);
    expect(stranger.names()).toEqual(member.names());
  });

  it("AC15: a stranger's claim passes null as the subject id, and changes nothing", async () => {
    const r = recorded();
    await issueSignInCode(r.inner, pendingFor(ADA, "042517"), { now: T0 });
    const before = await r.inner.getSignInCode(ADA.id);
    await verifySignInCode(r.store, r.findSubject, { email: STRANGER, code: "042517" }, { now: at(MINUTE) });
    const claim = r.calls.find((c) => c.name === "claimSignInAttempt");
    expect(claim?.args[0]).toBeNull();
    expect(await r.inner.getSignInCode(ADA.id)).toEqual(before);
  });
});
