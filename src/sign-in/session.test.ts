// Issue 9, AC24 and AC25: stateless session tokens, `base64url(JSON) + "." + base64url(HMAC-SHA256
// of the payload part)`, and the secret they are signed with.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEV_SESSION_SECRET,
  SESSION_TTL_MS,
  sessionSecret,
  signSession,
  verifySession,
  type Session,
} from "./session.js";

const SECRET = "s".repeat(32) + "-test-secret";
const OTHER_SECRET = "o".repeat(32) + "-other-secret";
const NOW = new Date("2026-10-28T14:25:30.000Z");
const EXPIRES = new Date(NOW.getTime() + SESSION_TTL_MS);
const session: Session = { subjectId: "6f1c2a52-8f7e-4c3b-9d0a-1b2c3d4e5f60", expiresAt: EXPIRES.toISOString() };

/** A token for any payload, signed the way the Data shapes say a session token is. */
function signRaw(payload: unknown, secret = SECRET): string {
  const part = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${part}.${createHmac("sha256", secret).update(part).digest("base64url")}`;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

describe("AC24 (issue 9) — signSession and verifySession", () => {
  it("AC24: SESSION_TTL_MS is 30 days", () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60_000);
  });

  it("AC24: before expiresAt a signed session verifies, with the same fields", () => {
    expect(verifySession(signSession(session, SECRET), SECRET, NOW)).toEqual({ ok: true, session });
    expect(verifySession(signSession(session, SECRET), SECRET, new Date(EXPIRES.getTime() - 1))).toEqual({
      ok: true,
      session,
    });
  });

  it("AC24: a token built as the Data shapes describe verifies", () => {
    expect(verifySession(signRaw(session), SECRET, NOW)).toEqual({ ok: true, session });
  });

  it.each([
    ["at expiresAt", 0],
    ["after expiresAt", 1],
    ["a day after expiresAt", 24 * 60 * 60_000],
  ])("AC24: %s → expired", (_when, after) => {
    const now = new Date(EXPIRES.getTime() + after);
    expect(verifySession(signSession(session, SECRET), SECRET, now)).toEqual({ ok: false, reason: "expired" });
  });

  it("AC24: a token signed with another secret → bad_signature", () => {
    expect(verifySession(signSession(session, OTHER_SECRET), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("AC24: any character of the payload part changed → bad_signature", () => {
    const token = signSession(session, SECRET);
    const dot = token.indexOf(".");
    expect(dot).toBeGreaterThan(0);
    for (let i = 0; i < dot; i++) {
      const original = token[i] ?? "";
      const replacement = BASE64URL[(BASE64URL.indexOf(original) + 1) % BASE64URL.length] ?? "A";
      const tampered = token.slice(0, i) + replacement + token.slice(i + 1);
      expect(verifySession(tampered, SECRET, NOW), `character ${i} changed`).toEqual({
        ok: false,
        reason: "bad_signature",
      });
    }
  });

  it.each(["", "abc", "abc.", ".abc"])("AC24: %j → malformed", (token) => {
    expect(verifySession(token, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it.each([
    ["no subjectId", { expiresAt: EXPIRES.toISOString() }],
    ["a numeric subjectId", { subjectId: 42, expiresAt: EXPIRES.toISOString() }],
    ["a null subjectId", { subjectId: null, expiresAt: EXPIRES.toISOString() }],
  ])("AC24: a correctly signed payload with %s → malformed", (_what, payload) => {
    expect(verifySession(signRaw(payload), SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("AC24: a correctly signed payload whose expiresAt is not a date → expired", () => {
    expect(verifySession(signRaw({ subjectId: session.subjectId, expiresAt: "not-a-date" }), SECRET, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("AC25 (issue 9) — sessionSecret", () => {
  const LONG = "x".repeat(32);

  it.each(["production", "development", "test", undefined])(
    "AC25: returns SESSION_SECRET when it is at least 32 characters (NODE_ENV %s)",
    (NODE_ENV) => {
      expect(sessionSecret({ SESSION_SECRET: LONG, ...(NODE_ENV === undefined ? {} : { NODE_ENV }) })).toBe(LONG);
      expect(sessionSecret({ SESSION_SECRET: `${LONG}yz`, ...(NODE_ENV === undefined ? {} : { NODE_ENV }) })).toBe(
        `${LONG}yz`,
      );
    },
  );

  it.each([
    ["missing", {}],
    ["31 characters", { SESSION_SECRET: "x".repeat(31) }],
    ["empty", { SESSION_SECRET: "" }],
  ])("AC25: in production, a secret that is %s throws an error naming SESSION_SECRET", (_what, env) => {
    expect(() => sessionSecret({ ...env, NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
  });

  it.each(["development", "test", undefined])("AC25: outside production (NODE_ENV %s), a missing secret returns DEV_SESSION_SECRET", (NODE_ENV) => {
    expect(sessionSecret(NODE_ENV === undefined ? {} : { NODE_ENV })).toBe(DEV_SESSION_SECRET);
  });
});
