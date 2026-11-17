import { sha256Key } from "./customer-match.js";
import { logStepFailure, recordDecline, recordOutcomeUnknown, renderReceipt, sendCharge, sendMemberEmail } from "./ledger-charge.js";
import type { EmailPort } from "./ports/email.js";
import { isCardRefusal, PaymentsError, type Card, type ChargeResult, type PaymentsPort } from "./ports/payments.js";
import type { Actor, PendingCharge, Repository } from "./ports/repository.js";
import { requireSupperClub } from "./products.js";
import { recordEventAs } from "./record-event.js";

/**
 * A member's card update (issue 145; DEC-003, DEC-040): the new card saved at Square, then one write puts it on file and
 * claims the open declined week, which is charged under the key its bumped attempt makes. The key and the card stay fixed
 * until that charge settles, by the member's Try again or the charge run's next firing, so a save while any row is
 * `pending` charges nothing and puts no card on file. The provider calls run between `withActor` commits, never inside
 * one. Everything written or recorded runs under the member.
 */

export type UpdateCardDeps = { repo: Repository; payments: PaymentsPort; email: EmailPort; siteUrl: string; clock: () => Date };

export type UpdateCardResult =
  | { outcome: "saved" }
  | { outcome: "paid"; ledgerId: string }
  | { outcome: "declined" }
  | { outcome: "unknown" }
  | { outcome: "error" };

/**
 * Saves `sourceId` as the member's card. `saved`: nothing was owed and the card is on file. `paid`: the card is on file and
 * the declined week's charge paid. `declined`: Square refused the card, or the week's charge was declined (the card stays on
 * file, the row is declined again). `unknown`: the week's charge got no answer, or a charge was already out, and Try again
 * finishes it. `error`: something failed before any charge was sent.
 */
export async function updateCard(deps: UpdateCardDeps, input: { memberId: string; sourceId: string }): Promise<UpdateCardResult> {
  try {
    return await save(deps, input);
  } catch (error) {
    logStepFailure("card update", "update", error);
    return { outcome: "error" };
  }
}

/** "Try again": asks Square whether the pending row's charge happened, then confirms what it finds or charges the row's card. */
export async function retryCardCharge(deps: UpdateCardDeps, input: { memberId: string }): Promise<UpdateCardResult> {
  try {
    return await resume(deps, input);
  } catch (error) {
    logStepFailure("card update", "retry", error);
    return { outcome: "error" };
  }
}

async function save(deps: UpdateCardDeps, { memberId, sourceId }: { memberId: string; sourceId: string }): Promise<UpdateCardResult> {
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

  const claim = await repo.withActor(actor, (scoped) => scoped.claimCardUpdate(subscription.id, card));
  switch (claim.kind) {
    case "claimed":
      return settle(deps, memberId, product.id, claim.charge, false);
    case "replaced":
      return { outcome: "saved" };
    case "busy":
      return { outcome: "unknown" };
    case "inactive":
      return { outcome: "error" };
  }
}

async function resume(deps: UpdateCardDeps, { memberId }: { memberId: string }): Promise<UpdateCardResult> {
  const { repo } = deps;
  const product = await requireSupperClub(repo);
  const subscription = await repo.findActiveSubscription(memberId, product.id);
  const charge = subscription && (await repo.findPendingCharge(subscription.id));
  return charge ? settle(deps, memberId, product.id, charge, true) : { outcome: "error" };
}

/**
 * Charges the claimed row, or, with `lookupFirst`, confirms what Square already took, and writes the result: paid, declined
 * through the signup's decline write, or unknown with the row left pending. A failure before a charge is out (the lookup
 * failing) is logged and recorded as nothing: the row is as it was.
 */
async function settle(deps: UpdateCardDeps, memberId: string, productId: string, charge: PendingCharge, lookupFirst: boolean): Promise<UpdateCardResult> {
  const { repo, payments, clock } = deps;
  const actor: Actor = { member: memberId };
  let out = false;
  try {
    const found = lookupFirst ? await payments.findPaymentByReference({ referenceId: charge.ledgerId, since: charge.createdAt }) : null;
    out = true;
    const result: ChargeResult = found ? { outcome: "paid", paymentId: found.paymentId } : await sendCharge(payments, { row: charge, cardId: charge.cardId, customerId: charge.customerId });
    if (result.outcome === "declined") {
      await recordDecline(repo, actor, memberId, charge.ledgerId, result.code);
      return { outcome: "declined" };
    }
    // What Square took, not what was asked: it must be the ledger's amount before the row turns paid.
    const chargedCents = found ? found.amountCents : charge.amountCents;
    // The answer is back: this is the moment `paid_at` records.
    const paidAt = clock();
    const confirmed = await repo.withActor(actor, (scoped) => scoped.confirmSignupRows(charge.ledgerId, result.paymentId, chargedCents, paidAt));
    if (confirmed === "mismatch") {
      await recordOutcomeUnknown(repo, actor, memberId, charge.ledgerId, { chargedCents });
      return { outcome: "unknown" };
    }
    // Only the call that turned the row paid emails: a row already paid has had its receipt.
    if (confirmed === "confirmed") {
      await sendMemberEmail(deps, "card update", memberId, (member) => renderReceipt(repo, productId, charge, paidAt, member, deps.siteUrl));
    }
    return { outcome: "paid", ledgerId: charge.ledgerId };
  } catch (error) {
    logStepFailure("card update", "charge", error);
    if (!out) return { outcome: "error" };
    await recordOutcomeUnknown(repo, actor, memberId, charge.ledgerId, error instanceof PaymentsError ? { code: error.code } : {});
    return { outcome: "unknown" };
  }
}
