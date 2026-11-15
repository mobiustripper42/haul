"use server";

// Issue 145: the member's card save. It reads `sourceId` only, acts on the subscription `requireSubscriber` gives the
// signed-in member, never on an id the form posts, and carries the outcome to the page in the URL. A cancelled
// subscription is sent to account home before anything reaches Square. What a save charges, keeps and records is
// `updateCard`'s (src/update-card.ts); the events it records are the entry's declared ones (app/audit-entry-points.ts).
import { redirect } from "next/navigation";
import { updateCard } from "@core/update-card.js";
import { ACCOUNT_PATH, accountCardPath } from "../../paths";
import { getEmail, getPayments, getRepository, getSiteUrl } from "../../services";
import { textField } from "../../sign-in/shared";
import { requireSubscriber } from "../subscriber";

/** Saves the new card and retries the declined weeks, then goes back to Update your card with the outcome. */
export async function saveCard(formData: FormData): Promise<void> {
  const { member, confirmation } = await requireSubscriber();
  if (confirmation.status === "cancelled") redirect(ACCOUNT_PATH);
  const result = await updateCard(
    { repo: getRepository(), payments: getPayments(), email: getEmail(), siteUrl: getSiteUrl(), clock: () => new Date() },
    { memberId: member.id, sourceId: textField(formData, "sourceId") },
  );
  redirect(accountCardPath(result.outcome, result.outcome === "retried" ? result.paid.map((row) => row.ledgerId) : []));
}
