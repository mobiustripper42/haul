import { createHmac, timingSafeEqual } from "node:crypto";

export type Session = {
  subjectId: string;
  /** ISO-8601 UTC. At or past this instant the token is dead. */
  expiresAt: string;
};

/** Absolute, not sliding: a copied cookie stays valid for its 30 days unless the secret is rotated. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export const DEV_SESSION_SECRET = "dev-insecure-session-secret";

const sign = (payloadPart: string, secret: string): string =>
  createHmac("sha256", secret).update(payloadPart).digest("base64url");

/** `base64url(JSON.stringify(session)) + "." + base64url(HMAC-SHA256(payload part, secret))`. */
export function signSession(session: Session, secret: string): string {
  const payloadPart = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payloadPart}.${sign(payloadPart, secret)}`;
}

export type SessionResult =
  | { ok: true; session: Session }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/** Well-formed, then signature (constant time), then not expired. */
export function verifySession(token: string, secret: string, now: Date): SessionResult {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };
  const payloadPart = token.slice(0, dot);

  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payloadPart, secret));
  // timingSafeEqual throws on unequal lengths, so a length check comes first.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: Partial<Session> | null;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Partial<Session> | null;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload?.subjectId !== "string" || typeof payload.expiresAt !== "string") {
    return { ok: false, reason: "malformed" };
  }
  // A date that doesn't parse is NaN, and can't be trusted to be in the future.
  const expiresAtMs = Date.parse(payload.expiresAt);
  if (Number.isNaN(expiresAtMs) || now.getTime() >= expiresAtMs) return { ok: false, reason: "expired" };
  return { ok: true, session: { subjectId: payload.subjectId, expiresAt: payload.expiresAt } };
}

/** The signing secret: `SESSION_SECRET` when it is at least 32 characters; otherwise production throws and development gets a fixed one. */
export function sessionSecret(env: { SESSION_SECRET?: string; NODE_ENV?: string }): string {
  const secret = env.SESSION_SECRET;
  if (secret !== undefined && secret.length >= 32) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set to at least 32 characters in production");
  }
  return DEV_SESSION_SECRET;
}
