// What Create Account's actions and the Supper Club's pane actions share. Not a "use server" file: every
// export of one is a public endpoint, and these take `pages`, which never comes from a form value.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACCOUNT_LIMITS, issueAccountCode, validateAccountDetails } from "@core/create-account.js";
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
  type FlowPages,
} from "../sign-in/shared";

/** Create Account's own pages. */
export const CREATE_ACCOUNT_PAGES: FlowPages = { start: "/create-account", code: "/create-account/code", done: "/" };

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
export async function requestAccountCodeFor(formData: FormData, pages: FlowPages): Promise<void> {
  const draft = {
    firstName: entered(formData, "firstName"),
    lastName: entered(formData, "lastName"),
    email: entered(formData, "email"),
    phone: entered(formData, "phone"),
    language: entered(formData, "language"),
  };
  const checked = validateAccountDetails(draft);
  if (!checked.ok) {
    // Each value cut to its limit, so a long one cannot overflow the cookie.
    const kept = {
      ...draft,
      firstName: draft.firstName.slice(0, ACCOUNT_LIMITS.firstName),
      lastName: draft.lastName.slice(0, ACCOUNT_LIMITS.lastName),
      email: draft.email.slice(0, ACCOUNT_LIMITS.email),
      phone: draft.phone.slice(0, ACCOUNT_LIMITS.phone),
    };
    await setFlowCookie(ACCOUNT_DRAFT_COOKIE, JSON.stringify(kept));
    redirect(`${pages.start}?error=${checked.errors.join(",")}`);
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
    redirect(`${pages.start}?limited=${limitedRedirectMinutes(decision.retryAfterMs)}`);
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
  redirect(pages.code);
}

/** "Send a new code": sign-in's request flow for the email in the cookie. Any `email` in the form is ignored. */
export async function resendAccountCodeFor(formData: FormData, pages: FlowPages): Promise<void> {
  const email = (await cookies()).get(SIGN_IN_EMAIL_COOKIE)?.value;
  if (!email) redirect(`${pages.start}?error=expired`);
  formData.set("email", email);
  await requestCodeFor(formData, pages);
}
