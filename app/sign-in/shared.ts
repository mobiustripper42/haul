// What sign-in and Create Account share. Not a "use server" file: a server-action file may export only
// async functions, and these include plain ones. The actions that call them live in each page's actions.ts.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createTranslator, pluralKey, type Language } from "@core/i18n.js";
import { deliverSignInCode, deliverSignInLink, signInLinkUrl } from "@core/sign-in-email.js";
import type { Repository } from "@core/ports/repository.js";
import { errorFields, recordEventAs } from "@core/record-event.js";
import { returnToOr } from "@core/return-to.js";
import { clientIpFrom } from "@core/sign-in/client-ip.js";
import {
  issueSignInCode,
  issueSignInLink,
  randomCode,
  randomLinkToken,
  requestSignInCode,
  SIGN_IN_REQUEST_LIMIT,
  verifySignInCode,
} from "@core/sign-in/code.js";
import { limitKeyFor, refusalFrom, takeRateLimit } from "@core/sign-in/rate-limit.js";
import type { RateLimitStore } from "@core/sign-in/store.js";
import { cleanTypedText } from "@core/typed-text.js";
import { RETURN_TO_COOKIE, SIGN_IN_EMAIL_COOKIE, startSession } from "../session";
import { getEmail, getRepository, getSessionSecret, getSiteUrl } from "../services";

const FLOW_COOKIE_MAX_AGE_SECONDS = 600;

/**
 * The pages of a flow: where its first step lives, where its code step lives, and where a confirmed code
 * lands when no return path is held (`/` for the full pages, `/supper-club` for the Supper Club's panes).
 */
export type FlowPages = { start: string; code: string; done: string };

export const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** The request limiter's store, each count a transaction of its own: its delete and upsert commit together. */
export const limiterStore = (repo: Repository): RateLimitStore => ({
  incrementRateLimit: (...count) => repo.withActor(null, (scoped) => scoped.incrementRateLimit(...count)),
});

/** The `limited` notice's minutes: an integer from 1 to 60, anything else shows no notice. */
export const limitedMinutes = (value: string | undefined): number | null => {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const minutes = Number(value);
  return minutes <= 60 ? minutes : null;
};

/** The `limited` notice's words for `minutes`, singular or plural by the language's rules. */
export const limitedText = (language: Language, minutes: number): string =>
  createTranslator(language)(pluralKey(language, "signIn.limited", minutes), { minutes });

/** The minutes a refused request is told to wait: the time left in the window, rounded up, at least one. */
export const limitedRedirectMinutes = (retryAfterMs: number): number => Math.max(1, Math.ceil(retryAfterMs / 60_000));

/**
 * Counts one request in sign-in's own limit for the client's address (issue 156). Null when it is allowed; when it is
 * not, the window's first refusal is recorded and the minutes to wait are returned. For the actions that count a
 * request with no sign-in around it: Your details' save with a new email and its resend.
 */
export async function takeRequestLimit(repo: Repository, now: Date): Promise<number | null> {
  const clientKey = limitKeyFor(clientIpFrom(await headers()));
  const decision = await takeRateLimit(
    { store: limiterStore(repo), now, onFailure: (message) => console.error(message) },
    SIGN_IN_REQUEST_LIMIT,
    clientKey,
  );
  if (decision.allowed) return null;
  const refusal = refusalFrom(decision, SIGN_IN_REQUEST_LIMIT.bucket, clientKey);
  if (refusal) await recordEventAs(repo, null, { kind: "rate_limit_refusal", ...refusal });
  return limitedRedirectMinutes(decision.retryAfterMs);
}

/**
 * The one writer of a flow cookie (`SIGN_IN_EMAIL_COOKIE`, `ACCOUNT_DRAFT_COOKIE`, `RETURN_TO_COOKIE`):
 * ten minutes, for this site only, out of reach of scripts.
 */
export async function setFlowCookie(name: string, value: string): Promise<void> {
  (await cookies()).set(name, value, {
    path: "/",
    maxAge: FLOW_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}

/**
 * Runs `store` then `send` after the response, so a member's request costs what a stranger's does.
 * Store first, send second, so nothing reaches an inbox before it can work. A failure is logged with
 * the stage that threw, without the error's message, the code, the link or the message text. The
 * member id is logged as given: null when the request had none before the response.
 */
export function sendAfterResponse<T>(
  memberId: string | null,
  store: () => Promise<T>,
  send: (stored: T) => Promise<void>,
  label = "sign-in email not delivered",
): void {
  after(async () => {
    let stage: "store" | "send" = "store";
    try {
      const stored = await store();
      stage = "send";
      await send(stored);
    } catch (error) {
      console.error(label, { stage, memberId, ...errorFields(error) });
    }
  });
}

/**
 * The end of every sign-in and every account confirmation, by code or by link: the email is confirmed
 * if it was not, the session starts, the flow's cookies go, and the person lands where they came from:
 * `done` when no return path was held, `/` when the one held is unsafe.
 */
export async function finishSignIn(subjectId: string, done: string): Promise<never> {
  await getRepository().withActor({ member: subjectId }, (scoped) => scoped.confirmMemberEmail(subjectId, new Date()));
  await startSession(subjectId);
  const cookieStore = await cookies();
  const returnTo = returnToOr(cookieStore.get(RETURN_TO_COOKIE)?.value, done);
  cookieStore.delete(SIGN_IN_EMAIL_COOKIE);
  cookieStore.delete(RETURN_TO_COOKIE);
  redirect(returnTo);
}

/** Asks for a code. A member's email and a stranger's get the same cookie and the same redirect. */
export async function requestCodeFor(formData: FormData, pages: FlowPages): Promise<void> {
  const email = cleanTypedText(textField(formData, "email"));
  if (email === "") redirect(pages.start);

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
    redirect(`${pages.start}?limited=${limitedRedirectMinutes(result.retryAfterMs)}`);
  }
  if (result.outcome === "issue") {
    const { pending } = result;
    sendAfterResponse(
      pending.subject.id,
      () => repo.withActor(null, (scoped) => issueSignInCode(scoped, pending, { now, mintLinkToken: randomLinkToken })),
      async (outcome) => {
        if (outcome.send === "code") await deliverSignInCode(getEmail(), pending, siteUrl);
        if (outcome.send === "link") {
          await deliverSignInLink(getEmail(), pending.subject, signInLinkUrl(siteUrl, outcome.token), siteUrl);
        }
      },
    );
  }

  await setFlowCookie(SIGN_IN_EMAIL_COOKIE, email);
  redirect(textField(formData, "resend") === "1" ? `${pages.code}?sent=1` : pages.code);
}

/** Redeems the code on a flow's code step. One failure for every reason, as sign-in has always had. */
export async function verifyCodeFor(formData: FormData, pages: FlowPages): Promise<void> {
  const cookieStore = await cookies();
  const email = cookieStore.get(SIGN_IN_EMAIL_COOKIE)?.value;
  if (!email) redirect(`${pages.start}?error=expired`);
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
          if (token) await deliverSignInLink(getEmail(), lockedNow, signInLinkUrl(siteUrl, token), siteUrl);
        },
      );
    }
    redirect(`${pages.code}?error=invalid`);
  }

  await recordEventAs(repo, { member: result.subjectId }, { kind: "sign_in_by_code", memberId: result.subjectId });
  await finishSignIn(result.subjectId, pages.done);
}
