"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { issueAccountCode, validateAccountDetails } from "@core/create-account.js";
import { recordEventAs } from "@core/record-event.js";
import { clientIpFrom } from "@core/sign-in/client-ip.js";
import { hashCode, randomCode, randomLinkToken, SIGN_IN_REQUEST_LIMIT } from "@core/sign-in/code.js";
import { limitKeyFor, refusalFrom, takeRateLimit } from "@core/sign-in/rate-limit.js";
import { deliverSignInCode, deliverSignInLink, signInLinkUrl } from "@core/sign-in-email.js";
import { ACCOUNT_DRAFT_COOKIE, SIGN_IN_EMAIL_COOKIE } from "../session";
import { getEmail, getRepository, getSiteUrl } from "../services";
import {
  limiterStore,
  limitedRedirectMinutes,
  requestCodeFor,
  sendAfterResponse,
  setFlowCookie,
  verifyCodeFor,
} from "../sign-in/shared";

const PAGES = { start: "/create-account", code: "/create-account/code" };

/** A form value as entered: not trimmed, since the draft cookie refills the form with what was typed. */
const entered = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * The details step. Details are checked before anything is counted; then the request is limited in
 * sign-in's own bucket. Nothing reads or writes a member before the response, so a new email, an
 * unconfirmed member and a confirmed one all get the same redirect, cookie and work after it.
 */
export async function requestAccountCode(formData: FormData): Promise<void> {
  const draft = {
    firstName: entered(formData, "firstName"),
    lastName: entered(formData, "lastName"),
    email: entered(formData, "email"),
    phone: entered(formData, "phone"),
    language: entered(formData, "language"),
  };
  const checked = validateAccountDetails(draft);
  if (!checked.ok) {
    await setFlowCookie(ACCOUNT_DRAFT_COOKIE, JSON.stringify(draft));
    redirect(`/create-account?error=${checked.errors.join(",")}`);
  }
  (await cookies()).delete(ACCOUNT_DRAFT_COOKIE);

  // Read before anything is counted or stored, so a misconfigured production fails the same way for
  // every request.
  const siteUrl = getSiteUrl();
  const repo = getRepository();
  const now = new Date();
  const clientKey = limitKeyFor(clientIpFrom(await headers()));
  const decision = await takeRateLimit(
    { store: limiterStore(repo), now, onFailure: (message) => console.error(message) },
    SIGN_IN_REQUEST_LIMIT,
    clientKey,
  );
  if (!decision.allowed) {
    const refusal = refusalFrom(decision, SIGN_IN_REQUEST_LIMIT.bucket, clientKey);
    if (refusal) await recordEventAs(repo, null, { kind: "rate_limit_refusal", ...refusal });
    redirect(`${PAGES.start}?limited=${limitedRedirectMinutes(decision.retryAfterMs)}`);
  }

  const { details } = checked;
  const code = randomCode();
  const pending = { code, codeHash: hashCode(code) };
  sendAfterResponse(
    null,
    () => issueAccountCode(repo, details, pending, { now, mintLinkToken: randomLinkToken }),
    async ({ member, outcome }) => {
      if (outcome.send === "code") await deliverSignInCode(getEmail(), { subject: member, ...pending });
      if (outcome.send === "link") await deliverSignInLink(getEmail(), member, signInLinkUrl(siteUrl, outcome.token));
    },
  );

  await setFlowCookie(SIGN_IN_EMAIL_COOKIE, details.email);
  redirect(PAGES.code);
}

export async function verifyAccountCode(formData: FormData): Promise<void> {
  await verifyCodeFor(formData, PAGES);
}

/** "Send a new code": sign-in's request flow for the email in the cookie. Any `email` in the form is ignored. */
export async function resendAccountCode(formData: FormData): Promise<void> {
  const email = (await cookies()).get(SIGN_IN_EMAIL_COOKIE)?.value;
  if (!email) redirect(`${PAGES.start}?error=expired`);
  formData.set("email", email);
  await requestCodeFor(formData, PAGES);
}
