"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { deliverSignInCode, deliverSignInLink, signInLinkUrl } from "@core/sign-in-email.js";
import type { Repository } from "@core/ports/repository.js";
import { errorFields, recordEventAs } from "@core/record-event.js";
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
import type { RateLimitStore } from "@core/sign-in/store.js";
import { endSession, SIGN_IN_EMAIL_COOKIE, startSession } from "../session";
import { getEmail, getRepository, getSessionSecret, getSiteUrl } from "../services";

const SIGN_IN_EMAIL_MAX_AGE_SECONDS = 600;

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** The request limiter's store, each count a transaction of its own: its delete and upsert commit together. */
const limiterStore = (repo: Repository): RateLimitStore => ({
  incrementRateLimit: (...count) => repo.withActor(null, (scoped) => scoped.incrementRateLimit(...count)),
});

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
    limiterStore(repo),
    (address) => repo.findMemberByEmail(address),
    { email, clientKey: limitKeyFor(clientIpFrom(await headers())) },
    { now, mintCode: randomCode, onLimiterFailure: (message) => console.error(message) },
  );

  if (result.outcome === "limited") {
    if (result.refusal) await recordEventAs(repo, null, { kind: "rate_limit_refusal", ...result.refusal });
    redirect(`/sign-in?limited=${Math.max(1, Math.ceil(result.retryAfterMs / 60_000))}`);
  }
  if (result.outcome === "issue") {
    const { pending } = result;
    sendAfterResponse(
      pending.subject.id,
      () => repo.withActor(null, (scoped) => issueSignInCode(scoped, pending, { now, mintLinkToken: randomLinkToken })),
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
  // Spending the attempt identifies nobody yet, so it runs as no one; the sign-in is recorded as the member.
  const result = await repo.withActor(null, (scoped) =>
    verifySignInCode(scoped, (address) => scoped.findMemberByEmail(address), { email, code: textField(formData, "code") }, { now }),
  );
  if (!result.ok) {
    // The guess that locked code sign-in emails the member a link, after the response, which is the
    // same for it as for any wrong guess.
    const { lockedNow } = result;
    if (lockedNow) {
      sendAfterResponse(
        lockedNow.id,
        async () => {
          await recordEventAs(repo, { member: lockedNow.id }, { kind: "lock", memberId: lockedNow.id });
          return repo.withActor(null, (scoped) =>
            issueSignInLink(scoped, lockedNow, { now, mintLinkToken: randomLinkToken, hold: false }),
          );
        },
        async (token) => {
          if (token) await deliverSignInLink(getEmail(), lockedNow, signInLinkUrl(siteUrl, token));
        },
      );
    }
    redirect("/sign-in/code?error=invalid");
  }

  await recordEventAs(repo, { member: result.subjectId }, { kind: "sign_in_by_code", memberId: result.subjectId });
  await finishSignIn(result.subjectId);
}

/** The one button on the emailed link's page: redeems the token and signs the member in. */
export async function signInWithLink(formData: FormData): Promise<void> {
  getSessionSecret();

  const repo = getRepository();
  const result = await repo.withActor(null, (scoped) =>
    redeemSignInLink(scoped, textField(formData, "token"), { now: new Date() }),
  );
  if (!result.ok) redirect("/sign-in?error=link");

  await recordEventAs(repo, { member: result.subjectId }, { kind: "sign_in_by_link", memberId: result.subjectId });
  await finishSignIn(result.subjectId);
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/");
}
