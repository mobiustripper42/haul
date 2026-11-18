// Test-only: issue 198's locked subscription, as the account pages' tests arrange it on an InMemoryRepository. Nothing that
// ships imports this.
import type { InMemoryRepository } from "@core/adapters/in-memory-repository.js";

/**
 * The card update that pays the subscription's open declined week, as `updateCard` writes it (src/update-card.ts): the
 * new card on file and the declined row claimed, then the row confirmed paid at `now`. The ledger id paid.
 */
export async function payDeclinedWeek(repo: InMemoryRepository, memberId: string, subscriptionId: string, now: Date): Promise<string> {
  await repo.setMemberSquareCustomer(memberId, "CUSTOMER_UPDATE");
  const claim = await repo.claimCardUpdate(subscriptionId, { id: "CARD_UPDATE", brand: "VISA", last4: "1111", expMonth: 12, expYear: 2030 });
  if (claim.kind !== "claimed") throw new Error(`the card update claimed no declined week: ${claim.kind}`);
  const confirmed = await repo.confirmSignupRows(claim.charge.ledgerId, "PAYMENT_UPDATE", claim.charge.amountCents, now);
  if (confirmed !== "confirmed") throw new Error(`the card update's charge did not confirm: ${confirmed}`);
  return claim.charge.ledgerId;
}
