import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Member } from "@core/members.js";
import { SESSION_TTL_MS, signSession, verifySession } from "@core/sign-in/session.js";
import { getRepository, getSessionSecret } from "./services";

export const SESSION_COOKIE = "ocf_session";
export const SIGN_IN_EMAIL_COOKIE = "ocf_sign_in_email";

/**
 * The signed-in member, or null: no cookie, a token that fails verification, or a member who is gone.
 * Cached per request: the layout, the translator and the page each ask, and one lookup serves all three.
 */
export const getSignedInMember = cache(async (): Promise<Member | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = verifySession(token, getSessionSecret(), new Date());
  if (!result.ok) return null;
  return getRepository().findMemberById(result.session.subjectId);
});

/**
 * The signed-in admin. Signed out → `/sign-in`; a member whose role is not `admin` → `/`. Every admin
 * page and admin server action calls it first; no check lives in a layout (DEC-018).
 */
export async function requireAdmin(): Promise<Member> {
  const member = await getSignedInMember();
  if (!member) redirect("/sign-in");
  if (member.role !== "admin") redirect("/");
  return member;
}

/** Signs the member in for 30 days. Cookies are written only in Server Functions, so call this from an action. */
export async function startSession(memberId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  (await cookies()).set(SESSION_COOKIE, signSession({ subjectId: memberId, expiresAt }, getSessionSecret()), {
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    sameSite: "lax",
    httpOnly: true,
    // mill-dev serves plain http, where a secure cookie would never come back.
    secure: process.env.NODE_ENV === "production",
  });
}

/** Clears the cookie. The token itself stays valid until it expires or `SESSION_SECRET` is rotated. */
export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
