"use server";

// The pane's server actions: each is the action it mirrors, with a fixed page set from paths.ts so every
// failure and every redirect stays in the pane. The page set never comes from a form value.
import { redirect } from "next/navigation";
import { choicesQuery, resolveChoices } from "@core/choices.js";
import { firstPickup } from "@core/pickup-week.js";
import { priceOfChoices, requireSupperClub, type ProductWithOptions } from "@core/products.js";
import type { Repository } from "@core/ports/repository.js";
import { retrySignup, signUp, type SignupResult } from "@core/signup.js";
import { requestAccountCodeFor, resendAccountCodeFor } from "../create-account/shared";
import { getLanguage, getTranslator } from "../language";
import { getPayments, getRepository } from "../services";
import { getSignedInMember } from "../session";
import { requestCodeFor, textField, verifyCodeFor } from "../sign-in/shared";
import { paymentWording } from "./payment-wording";
import {
  PANE_CREATE_PAGES,
  PANE_SIGN_IN_PAGES,
  PAY_ERROR_SOLD_OUT,
  SUPPER_CLUB_ALREADY_PATH,
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

/** Back to the page with why, and the picks kept, so the member can try again where they were. */
const backToPage = (payError: "consent" | "declined" | "unknown" | typeof PAY_ERROR_SOLD_OUT | "error", choices: Record<string, string> | null): string =>
  `${SUPPER_CLUB_PATH}?${new URLSearchParams({ payError })}${choices ? `&${choicesQuery(choices)}` : ""}`;

/** Where each outcome of a signup lands. */
function landing(result: SignupResult, choices: Record<string, string> | null): string {
  switch (result.outcome) {
    case "paid":
      return SUPPER_CLUB_DONE_PATH;
    case "already_subscribed":
      return SUPPER_CLUB_ALREADY_PATH;
    case "sold_out":
      return backToPage(PAY_ERROR_SOLD_OUT, choices);
    default:
      return backToPage(result.outcome, choices);
  }
}

/**
 * Pay. A visitor goes to the sign-in pane and an unticked box back to the page; otherwise the price, the
 * first pickup and the consent wording are all worked out here, from the option ids and the clock. Nothing
 * of the sort is read from the form but the picks, the card token and the tick.
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
    firstPickup: firstPickup(product, now),
    language: await getLanguage(),
  });
  const result = await signUp(
    { repo, payments: getPayments(), now },
    { memberId: member.id, choices, sourceId: textField(formData, "sourceId"), consentText: wording.consentText },
  );
  redirect(landing(result, choices));
}

/** "Try again" on a payment that got no answer: Square is asked first, and only then is the saved card charged. */
export async function retrySupperClubPayment(): Promise<void> {
  const member = await getSignedInMember();
  if (!member) redirect(PANE_SIGN_IN_PAGES.start);

  const repo = getRepository();
  const result = await retrySignup({ repo, payments: getPayments(), now: new Date() }, { memberId: member.id });
  // A decline shows the normal form again, with the picks the pending row holds.
  const kept = result.outcome === "declined" || result.outcome === "error" ? await picksOf(repo, member.id) : null;
  redirect(landing(result, kept));
}

/** The picks of the member's pending signup, as choices; null when there is none. */
async function picksOf(repo: Repository, memberId: string): Promise<Record<string, string> | null> {
  const product: ProductWithOptions = await requireSupperClub(repo);
  const row = await repo.findPendingSignup(memberId, product.id);
  if (!row) return null;
  return Object.fromEntries(
    product.optionTypes.flatMap((type) => {
      const picked = type.options.find((option) => row.optionIds.includes(option.id));
      return picked ? [[type.id, picked.id]] : [];
    }),
  );
}
