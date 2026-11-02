"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { deliverSignInCode, deliverSignInLink, signInLinkUrl } from "@core/sign-in-email.js";
import { EmailSendError } from "@core/ports/email.js";
import type { AuditEvent, Repository } from "@core/ports/repository.js";
import { clientIpFrom } from "@core/sign-in/client-ip.js";
import {
  issueSignInCode,
  issueSignInLink,
  randomCode,
  randomLinkToken,
  redeemSignInLink,
  requestSignInCode,
  verifySignInCode,
} from "@core/sign-in/code.js";
import { limitKeyFor } from "@core/sign-in/rate-limit.js";
import { endSession, SIGN_IN_EMAIL_COOKIE, startSession } from "../session";
import { getEmail, getRepository, getSessionSecret, getSiteUrl } from "../services";

const SIGN_IN_EMAIL_MAX_AGE_SECONDS = 600;

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/**
 * What a log says about an error: its name, its `code` when that is a string (a Postgres SQLSTATE,
 * or a Node system code like ECONNREFUSED) and a failed send's status. Never its message: Resend's
 * carries its whole reply and a connection error's carries the connection string.
 */
function errorFields(error: unknown): { error: string; code?: string; status?: number } {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return {
    error: error instanceof Error ? error.name : typeof error,
    ...(typeof code === "string" ? { code } : {}),
    ...(error instanceof EmailSendError ? { status: error.status } : {}),
  };
}

/**
 * Records an audit event. A failure is logged and goes no further: the sign-in, the lock's link and
 * the refusal all go ahead, so `audit_log` can have gaps that only the server log shows. The log
 * names the event and the member, never the client address a refusal carries.
 */
async function recordEvent(repo: Repository, event: AuditEvent): Promise<void> {
  try {
    await repo.recordEvent(event);
  } catch (error) {
    console.error("sign-in event not recorded", {
      event: event.kind,
      ...(event.kind === "rate_limit_refusal" ? {} : { memberId: event.memberId }),
      ...errorFields(error),
    });
  }
}

/**
 * Runs `store` then `send` after the response, so a member's request costs what a stranger's does.
 * Store first, send second, so nothing reaches an inbox before it can work. A failure is logged with
 * the stage that threw, without the error's message, the code, the link or the message text.
 */
function sendAfterResponse<T>(
  memberId: string,
  store: () => Promise<T>,
  send: (stored: T) => Promise<void>,
): void {
  after(async () => {
    let stage: "store" | "send" = "store";
    try {
      const stored = await store();
      stage = "send";
      await send(stored);
    } catch (error) {
      console.error("sign-in email not delivered", { stage, memberId, ...errorFields(error) });
    }
  });
}

/** The end of every sign-in: the session starts, the email cookie goes, and the member lands on the home page. */
async function finishSignIn(subjectId: string): Promise<never> {
  await startSession(subjectId);
  (await cookies()).delete(SIGN_IN_EMAIL_COOKIE);
  redirect("/");
}

/** Asks for a code. A member's email and a stranger's get the same cookie and the same redirect. */
export async function requestCode(formData: FormData): Promise<void> {
  const email = textField(formData, "email");
  if (email === "") redirect("/sign-in");

  // Read before anything is counted or stored, so a misconfigured production fails the same way for
  // every request: limited, a member's or a stranger's.
  const siteUrl = getSiteUrl();
  const repo = getRepository();
  const now = new Date();
  const result = await requestSignInCode(
    repo,
    (address) => repo.findMemberByEmail(address),
    { email, clientKey: limitKeyFor(clientIpFrom(await headers())) },
    { now, mintCode: randomCode, onLimiterFailure: (message) => console.error(message) },
  );

  if (result.outcome === "limited") {
    if (result.refusal) await recordEvent(repo, { kind: "rate_limit_refusal", ...result.refusal });
    redirect(`/sign-in?limited=${Math.max(1, Math.ceil(result.retryAfterMs / 60_000))}`);
  }
  if (result.outcome === "issue") {
    const { pending } = result;
    sendAfterResponse(
      pending.subject.id,
      () => issueSignInCode(repo, pending, { now, mintLinkToken: randomLinkToken }),
      async (outcome) => {
        if (outcome.send === "code") await deliverSignInCode(getEmail(), pending);
        if (outcome.send === "link") {
          await deliverSignInLink(getEmail(), pending.subject, signInLinkUrl(siteUrl, outcome.token));
        }
      },
    );
  }

  (await cookies()).set(SIGN_IN_EMAIL_COOKIE, email, {
    path: "/",
    maxAge: SIGN_IN_EMAIL_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/sign-in/code");
}

export async function verifyCode(formData: FormData): Promise<void> {
  const cookieStore = await cookies();
  const email = cookieStore.get(SIGN_IN_EMAIL_COOKIE)?.value;
  if (!email) redirect("/sign-in?error=expired");
  // Read before the code is spent, so a production deploy missing its secret fails without burning one.
  getSessionSecret();
  const siteUrl = getSiteUrl();

  const repo = getRepository();
  const now = new Date();
  const result = await verifySignInCode(
    repo,
    (address) => repo.findMemberByEmail(address),
    { email, code: textField(formData, "code") },
    { now },
  );
  if (!result.ok) {
    // The guess that locked code sign-in emails the member a link, after the response, which is the
    // same for it as for any wrong guess.
    const { lockedNow } = result;
    if (lockedNow) {
      sendAfterResponse(
        lockedNow.id,
        async () => {
          await recordEvent(repo, { kind: "lock", memberId: lockedNow.id });
          return issueSignInLink(repo, lockedNow, { now, mintLinkToken: randomLinkToken, hold: false });
        },
        async (token) => {
          if (token) await deliverSignInLink(getEmail(), lockedNow, signInLinkUrl(siteUrl, token));
        },
      );
    }
    redirect("/sign-in/code?error=invalid");
  }

  await recordEvent(repo, { kind: "sign_in_by_code", memberId: result.subjectId });
  await finishSignIn(result.subjectId);
}

/** The one button on the emailed link's page: redeems the token and signs the member in. */
export async function signInWithLink(formData: FormData): Promise<void> {
  getSessionSecret();

  const repo = getRepository();
  const result = await redeemSignInLink(repo, textField(formData, "token"), { now: new Date() });
  if (!result.ok) redirect("/sign-in?error=link");

  await recordEvent(repo, { kind: "sign_in_by_link", memberId: result.subjectId });
  await finishSignIn(result.subjectId);
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/");
}
