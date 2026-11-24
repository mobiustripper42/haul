"use server";

// The pane's server actions: each is the action it mirrors, with a fixed page set from paths.ts so every
// failure and every redirect stays in the pane. The page set never comes from a form value.
import { redirect } from "next/navigation";
import { choicesQuery, resolveChoices } from "@core/choices.js";
import { siteLink } from "@core/email-templates.js";
import { clevelandDate, firstPickup } from "@core/pickup-week.js";
import { priceOfChoices, requireSupperClub } from "@core/products.js";
import type { Repository } from "@core/ports/repository.js";
import { isChargeOut, signUp, type SignupResult } from "@core/signup.js";
import { deliverSignupConfirmation } from "@core/signup-email.js";
import { requestAccountCodeFor, resendAccountCodeFor } from "../create-account/shared";
import { getLanguage, getTranslator } from "../language";
import { ACCOUNT_PATH } from "../paths";
import { getEmail, getPayments, getRepository, getSiteUrl } from "../services";
import { getSignedInMember } from "../session";
import { requestCodeFor, sendAfterResponse, textField, verifyCodeFor } from "../sign-in/shared";
import { paymentWording } from "./payment-wording";
import { picksOf } from "./picks";
import {
  PANE_CREATE_PAGES,
  PANE_SIGN_IN_PAGES,
  PAY_ERROR_SOLD_OUT,
  SUPPER_CLUB_ALREADY_FROM_PAY_PATH,
  SUPPER_CLUB_DONE_PATH,
  SUPPER_CLUB_PATH,
} from "./paths";

export async function requestPaneCode(formData: FormData): Promise<void> {
  await requestCodeFor(formData, PANE_SIGN_IN_PAGES);
}

export async function verifyPaneCode(formData: FormData): Promise<void> {
  await verifyCodeFor(formData, PANE_SIGN_IN_PAGES);
}

export async function requestPaneAccountCode(formData: FormData): Promise<void> {
  await requestAccountCodeFor(formData, PANE_CREATE_PAGES);
}

export async function verifyPaneAccountCode(formData: FormData): Promise<void> {
  await verifyCodeFor(formData, PANE_CREATE_PAGES);
}

export async function resendPaneAccountCode(formData: FormData): Promise<void> {
  await resendAccountCodeFor(formData, PANE_CREATE_PAGES);
}

/** Back to the page with why, and the picks kept, so the member can enter their card again where they were. */
const backToPage = (payError: "consent" | "declined" | "unknown" | typeof PAY_ERROR_SOLD_OUT | "error", choices: Record<string, string> | null): string =>
  `${SUPPER_CLUB_PATH}?${new URLSearchParams({ payError })}${choices ? `&${choicesQuery(choices)}` : ""}`;

/** Where each outcome of a signup lands. */
function landing(result: SignupResult, choices: Record<string, string> | null): string {
  switch (result.outcome) {
    case "paid":
      return SUPPER_CLUB_DONE_PATH;
    case "already_subscribed":
      return SUPPER_CLUB_ALREADY_FROM_PAY_PATH;
    case "sold_out":
      return backToPage(PAY_ERROR_SOLD_OUT, choices);
    default:
      return backToPage(result.outcome, choices);
  }
}

/**
 * The confirmation email, after the response, and only for the request that flipped the rows to confirmed
 * (`confirmedNow`), so no path can send it twice. Every read runs in the store step and the site address in
 * the send step, so a failure is logged and never reaches a signup that is already paid.
 */
function sendConfirmationAfterResponse(repo: Repository, memberId: string, result: SignupResult): void {
  if (result.outcome !== "paid" || !result.confirmedNow) return;
  sendAfterResponse(
    memberId,
    async () => {
      const product = await requireSupperClub(repo);
      const member = await repo.findMemberById(memberId);
      if (!member) throw new Error("The member is gone");
      const confirmation = await repo.findSignupConfirmation(memberId, product.id);
      if (!confirmation) throw new Error("The signup has no confirmation");
      return { member, confirmation };
    },
    async ({ member, confirmation }) => {
      const siteUrl = getSiteUrl();
      await deliverSignupConfirmation(getEmail(), member, confirmation, siteLink(siteUrl, ACCOUNT_PATH), siteUrl);
    },
    "signup email not delivered",
  );
}

/**
 * Pay. A visitor goes to the sign-in pane and an unticked box back to the page; otherwise the price, the
 * first pickup and the consent wording are all worked out here, from the option ids and the clock. Nothing
 * of the sort is read from the form but the picks, the card token and the tick. Over a charge that is out the card is
 * charged under that charge's key for the row's own picks, and a landing back on the page carries the row's picks, not
 * the ones submitted.
 */
export async function joinSupperClub(formData: FormData): Promise<void> {
  const member = await getSignedInMember();
  if (!member) redirect(PANE_SIGN_IN_PAGES.start);

  const repo = getRepository();
  const product = await requireSupperClub(repo);
  const choices = resolveChoices(
    product,
    Object.fromEntries(product.optionTypes.map((type) => [type.id, textField(formData, type.id)])),
  );
  if (formData.get("consent") === null) redirect(backToPage("consent", choices));

  const now = new Date();
  const wording = paymentWording(await getTranslator(), {
    priceCents: priceOfChoices(product, choices),
    firstPickup: firstPickup(product, now, await repo.listChangedWeeks(product.id, clevelandDate(now))).firstDay,
    language: await getLanguage(),
  });
  const held = await repo.findPendingSignup(member.id, product.id);
  const result = await signUp(
    { repo, payments: getPayments(), now, clock: () => new Date() },
    { memberId: member.id, choices, sourceId: textField(formData, "sourceId"), consentText: wording.consentText },
  );
  sendConfirmationAfterResponse(repo, member.id, result);
  // A landing that sends the member back to the form shows what the row holds, once a charge was out over it.
  const backToForm = result.outcome === "declined" || result.outcome === "error" || result.outcome === "unknown";
  const kept = backToForm && held !== null && isChargeOut(held) ? ((await picksOf(repo, member.id)) ?? choices) : choices;
  redirect(landing(result, kept));
}
