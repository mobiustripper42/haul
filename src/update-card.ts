import { sha256Key } from "./customer-match.js";
import { logStepFailure, recordOutcomeUnknown, renderReceipt, sendCharge, sendMemberEmail } from "./ledger-charge.js";
import type { EmailPort } from "./ports/email.js";
import { isCardRefusal, PaymentsError, type Card, type PaymentsPort } from "./ports/payments.js";
import type { Actor, DeclinedCharge, Repository } from "./ports/repository.js";
import { requireSupperClub } from "./products.js";
import { recordEventAs } from "./record-event.js";

/**
 * A member's card update (issue 145; DEC-003, DEC-004): the new card saved at Square, then every declined week of their
 * subscription charged to it, one charge per week, each under a fresh idempotency key: the row's attempt is bumped
 * before the charge, and stays bumped after a failure. The new card takes the subscription only once it has paid a week,
 * or at once when nothing is owed, so a failed save changes nothing. The provider calls run between `withActor` commits,
 * never inside one. Everything written or recorded runs under the member.
 */

export type UpdateCardDeps = { repo: Repository; payments: PaymentsPort; email: EmailPort; siteUrl: string; clock: () => Date };

type PaidRow = { ledgerId: string; pickupDate: string; amountCents: number };

export type UpdateCardResult =
  | { outcome: "saved"; card: Card }
  | { outcome: "retried"; card: Card; paid: PaidRow[] }
  | { outcome: "declined" }
  | { outcome: "error" };

/**
 * Saves `sourceId` as the member's card and retries their declined weeks on it. `saved`: nothing was owed and the card is
 * on file. `retried`: the card is on file and `paid` are the weeks it paid. `declined`: Square refused the card, or the
 * first week it was charged was declined or got no answer; nothing changed. `error`: something failed before any charge.
 */
export async function updateCard(deps: UpdateCardDeps, input: { memberId: string; sourceId: string }): Promise<UpdateCardResult> {
  try {
    return await run(deps, input);
  } catch (error) {
    logStepFailure("card update", "update", error);
    return { outcome: "error" };
  }
}

async function run(deps: UpdateCardDeps, { memberId, sourceId }: { memberId: string; sourceId: string }): Promise<UpdateCardResult> {
  const { repo, payments } = deps;
  const actor: Actor = { member: memberId };
  const product = await requireSupperClub(repo);
  const subscription = await repo.findActiveSubscription(memberId, product.id);
  const customerId = (await repo.findMemberById(memberId))?.squareCustomerId;
  if (!subscription || !customerId) return { outcome: "error" };

  let card: Card;
  try {
    card = await payments.saveCard({ customerId, sourceId, idempotencyKey: sha256Key(sourceId) });
  } catch (error) {
    // A card Square refuses to save is a decline; any other failure charged nothing and is an error.
    if (!isCardRefusal(error)) throw error;
    await recordEventAs(repo, actor, { kind: "card_declined", memberId, detail: { code: error.code } });
    return { outcome: "declined" };
  }

  const owed = (await repo.listDeclinedCharges(subscription.id)).filter((row) => !row.closed);
  if (owed.length === 0) {
    const replaced = await repo.withActor(actor, (scoped) => putOnFile(scoped, subscription.id, card));
    return replaced ? { outcome: "saved", card } : { outcome: "error" };
  }

  const paid: PaidRow[] = [];
  for (const row of owed) {
    if (!(await retry(deps, { actor, memberId, productId: product.id, subscriptionId: subscription.id, customerId, card, row, first: paid.length === 0 }, paid))) break;
  }
  return paid.length > 0 ? { outcome: "retried", card, paid } : { outcome: "declined" };
}

/** The new card on the subscription, and the closed weeks' declined rows, which will never be retried, gone. */
async function putOnFile(repo: Repository, subscriptionId: string, card: Card): Promise<boolean> {
  const replaced = await repo.replaceSubscriptionCard(subscriptionId, card);
  if (replaced) await repo.dropClosedDeclinedRows(subscriptionId);
  return replaced;
}

/**
 * Charges one declined week to the new card and, when it pays, adds it to `paid`: the first one to pay also puts the card
 * on file in the same commit that confirms it. True when the week paid and the next may be tried; false when the
 * retry stops here, on a decline or an outcome that is unknown, each of which is recorded.
 */
async function retry(
  deps: UpdateCardDeps,
  step: { actor: Actor; memberId: string; productId: string; subscriptionId: string; customerId: string; card: Card; row: DeclinedCharge; first: boolean },
  paid: PaidRow[],
): Promise<boolean> {
  const { repo, payments, clock } = deps;
  const { actor, memberId, productId, subscriptionId, customerId, card, row, first } = step;
  try {
    const attempt = await repo.withActor(actor, (scoped) => scoped.bumpLedgerAttempt(row.ledgerId));
    if (attempt === null) throw new Error("The declined row is no longer declined");
    const result = await sendCharge(payments, { row: { ledgerId: row.ledgerId, attempt, amountCents: row.amountCents }, cardId: card.id, customerId });
    if (result.outcome === "declined") {
      await recordEventAs(repo, actor, { kind: "card_declined", memberId, detail: { ledgerId: row.ledgerId, code: result.code } });
      return false;
    }
    // The answer is back: this is the moment `paid_at` records.
    const paidAt = clock();
    const confirmed = await repo.withActor(actor, async (scoped) => {
      const answer = await scoped.confirmSignupRows(row.ledgerId, result.paymentId, row.amountCents, paidAt);
      if (first && answer !== "mismatch") await putOnFile(scoped, subscriptionId, card);
      return answer;
    });
    if (confirmed === "mismatch") {
      await recordOutcomeUnknown(repo, actor, memberId, row.ledgerId, { chargedCents: row.amountCents });
      return false;
    }
    paid.push({ ledgerId: row.ledgerId, pickupDate: row.pickupDate, amountCents: row.amountCents });
    // Only the call that turned the row paid emails: a row already paid has had its receipt.
    if (confirmed === "confirmed") {
      await sendMemberEmail(deps, "card update", memberId, (member) => renderReceipt(repo, productId, row, paidAt, member, deps.siteUrl));
    }
    return true;
  } catch (error) {
    logStepFailure("card update", "charge", error);
    await recordOutcomeUnknown(repo, actor, memberId, row.ledgerId, error instanceof PaymentsError ? { code: error.code } : {});
    return false;
  }
}
