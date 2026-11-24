"use server";

// Issue 145: the member's card save and its Try again. A save reads `sourceId` only; both act on the subscription
// `requireSubscriber` gives the signed-in member, never on an id the form posts, and carry the outcome to the page in the
// URL. A cancelled subscription is sent to account home before anything reaches Square. What a save or a Try again charges,
// keeps and records is `updateCard`'s and `retryCardCharge`'s (src/update-card.ts); the events they record are each entry's
// declared ones (app/audit-entry-points.ts).
import { redirect } from "next/navigation";
import { retryCardCharge, updateCard, type UpdateCardDeps, type UpdateCardResult } from "@core/update-card.js";
import { ACCOUNT_PATH, accountCardPath } from "../../paths";
import { getEmail, getPayments, getRepository, getSiteUrl } from "../../services";
import { textField } from "../../sign-in/shared";
import { requireSubscriber } from "../subscriber";

const deps = (): UpdateCardDeps => ({ repo: getRepository(), payments: getPayments(), email: getEmail(), siteUrl: getSiteUrl(), clock: () => new Date() });

/** Back to Update your card with the outcome, and for a paid week the row it paid. */
const landOn = (result: UpdateCardResult): never =>
  redirect(accountCardPath(result.outcome, result.outcome === "paid" || result.outcome === "paidNoCard" ? result.ledgerId : undefined));

/** Charges the declined week on the new card's token and saves the card from the payment (or saves it alone when nothing is owed), then goes back to Update your card with the outcome. */
export async function saveCard(formData: FormData): Promise<void> {
  const { member, confirmation } = await requireSubscriber();
  if (confirmation.status === "cancelled") redirect(ACCOUNT_PATH);
  landOn(await updateCard(deps(), { memberId: member.id, sourceId: textField(formData, "sourceId") }));
}

/** Try again on the subscription's row whose charge is out: Square is asked first, then the row is settled as a save settles it. */
export async function retryCard(): Promise<void> {
  const { member, confirmation } = await requireSubscriber();
  if (confirmation.status === "cancelled") redirect(ACCOUNT_PATH);
  landOn(await retryCardCharge(deps(), { memberId: member.id }));
}
