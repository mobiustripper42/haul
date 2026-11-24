import { sha256Key } from "./customer-match.js";
import {
  abandonIfDead,
  logStepFailure,
  recordDecline,
  recordOutcomeUnknown,
  renderReceipt,
  sendCharge,
  sendMemberEmail,
  settlePaid,
} from "./ledger-charge.js";
import type { EmailPort } from "./ports/email.js";
import { isCardRefusal, PaymentsError, requireCardToken, type Card, type ChargeResult, type PaymentsPort } from "./ports/payments.js";
import type { Actor, PendingCharge, Repository } from "./ports/repository.js";
import { requireSupperClub } from "./products.js";
import { recordEventAs } from "./record-event.js";

/**
 * A member's card update (issue 145; DEC-003, DEC-053): with a declined week owed, the claim turns its row pending with
 * the card token on it, the token is charged under the key its bumped attempt makes, and the card is saved from the
 * payment. With nothing owed the card is saved alone. The key and the token stay fixed until that charge settles, by the
 * member's Try again, or by a firing of the charge run that finds Square took it (the run never sends it), so a save while
 * any row is `pending` charges nothing and saves no card. The provider calls run between `withActor` commits, never inside
 * one. Everything written or recorded runs under the member.
 */

export type UpdateCardDeps = { repo: Repository; payments: PaymentsPort; email: EmailPort; siteUrl: string; clock: () => Date };

export type UpdateCardResult =
  | { outcome: "saved" }
  | { outcome: "paid"; ledgerId: string }
  | { outcome: "paidNoCard"; ledgerId: string }
  | { outcome: "declined" }
  | { outcome: "unknown" }
  | { outcome: "error" };

/**
 * Saves `sourceId` as the member's card. `saved`: nothing was owed and the card is on file. `paid`: the declined week's
 * charge paid and the card is on file. `paidNoCard`: it paid, but the card could not be saved from the payment, so the old
 * card, if any, stays on file. `declined`: Square refused the card, or the week's charge was declined (the old card stays
 * on file, the row is declined again). `unknown`: the week's charge got no answer, or a charge was already out, and Try
 * again finishes it. `error`: something failed before any charge was sent, or Try again met a dead card token.
 */
export async function updateCard(deps: UpdateCardDeps, input: { memberId: string; sourceId: string }): Promise<UpdateCardResult> {
  try {
    return await save(deps, input);
  } catch (error) {
    logStepFailure("card update", "update", error);
    return { outcome: "error" };
  }
}

/** "Try again": asks Square whether the pending row's charge happened, then confirms what it finds or charges the row again. */
export async function retryCardCharge(deps: UpdateCardDeps, input: { memberId: string }): Promise<UpdateCardResult> {
  try {
    return await resume(deps, input);
  } catch (error) {
    logStepFailure("card update", "retry", error);
    return { outcome: "error" };
  }
}

async function save(deps: UpdateCardDeps, { memberId, sourceId }: { memberId: string; sourceId: string }): Promise<UpdateCardResult> {
  const { repo } = deps;
  const actor: Actor = { member: memberId };
  const product = await requireSupperClub(repo);
  const subscription = await repo.findActiveSubscription(memberId, product.id);
  const customerId = (await repo.findMemberById(memberId))?.squareCustomerId;
  if (!subscription || !customerId) return { outcome: "error" };

  // A blank token, or CASH or EXTERNAL, is an error before anything is claimed, charged or saved.
  requireCardToken(sourceId);

  const claim = await repo.withActor(actor, (scoped) => scoped.claimCardUpdate(subscription.id, sourceId));
  switch (claim.kind) {
    case "claimed":
      return settle(deps, memberId, product.id, claim.charge, false);
    case "nothing_owed":
      return saveAlone(deps, memberId, subscription.id, customerId, sourceId);
    case "busy":
      return { outcome: "unknown" };
    case "inactive":
      return { outcome: "error" };
  }
}

/** With nothing owed the token is spent on a save alone, and the card replaces the one on file. */
async function saveAlone(deps: UpdateCardDeps, memberId: string, subscriptionId: string, customerId: string, sourceId: string): Promise<UpdateCardResult> {
  const { repo, payments } = deps;
  const actor: Actor = { member: memberId };
  let card: Card;
  try {
    card = await payments.saveCard({ customerId, sourceId, idempotencyKey: sha256Key(sourceId) });
  } catch (error) {
    // A card Square refuses to save is a decline; any other failure charged nothing and is an error.
    if (!isCardRefusal(error)) throw error;
    await recordEventAs(repo, actor, { kind: "card_declined", memberId, detail: { code: error.code } });
    return { outcome: "declined" };
  }
  // A cancel or a pending row that landed while Square saved the card is refused here, as the claim refuses it.
  const replaced = await repo.withActor(actor, (scoped) => scoped.replaceSubscriptionCard(subscriptionId, card));
  if (replaced === "replaced") return { outcome: "saved" };
  return { outcome: replaced === "busy" ? "unknown" : "error" };
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
 * through the signup's decline write, or unknown with the row left pending. A row with a token is charged on it,
 * buyer-started, and the card is saved from the payment; a charge run's row is charged on its saved card as the run does.
 * A failure before a charge is out (the lookup failing) is logged and recorded as nothing: the row is as it was. A dead
 * token on Try again abandons the charge: the row is declined again and the member enters the card again (`error`).
 */
async function settle(deps: UpdateCardDeps, memberId: string, productId: string, charge: PendingCharge, lookupFirst: boolean): Promise<UpdateCardResult> {
  const { repo, payments, clock } = deps;
  const actor: Actor = { member: memberId };
  let out = false;
  try {
    const found = lookupFirst ? await payments.findPaymentByReference({ referenceId: charge.ledgerId, since: charge.createdAt }) : null;
    out = true;
    const result: ChargeResult = found ? { outcome: "paid", paymentId: found.paymentId } : await sendCharge(payments, { row: charge, ...source(charge) });
    if (result.outcome === "declined") {
      await recordDecline(repo, actor, memberId, charge.ledgerId, result.code);
      return { outcome: "declined" };
    }
    // What Square took, not what was asked: it must be the ledger's amount before the row turns paid.
    const chargedCents = found ? found.amountCents : charge.amountCents;
    // The answer is back: this is the moment `paid_at` records.
    const paidAt = clock();
    const { confirmed, cardSaved } =
      charge.chargeSource === null
        ? { confirmed: await repo.withActor(actor, (scoped) => scoped.confirmSignupRows(charge.ledgerId, result.paymentId, chargedCents, paidAt)), cardSaved: true }
        : await settlePaid(repo, payments, actor, {
            ledgerId: charge.ledgerId,
            paymentId: result.paymentId,
            amountCents: chargedCents,
            customerId: charge.customerId,
            memberId,
            paidAt,
          });
    if (confirmed === "mismatch") {
      await recordOutcomeUnknown(repo, actor, memberId, charge.ledgerId, { chargedCents });
      return { outcome: "unknown" };
    }
    // Only the call that turned the row paid emails: a row already paid has had its receipt, whether or not the card was saved.
    if (confirmed === "confirmed") {
      await sendMemberEmail(deps, "card update", memberId, (member) => renderReceipt(repo, productId, charge, paidAt, member, deps.siteUrl));
    }
    return confirmed === "confirmed" && !cardSaved ? { outcome: "paidNoCard", ledgerId: charge.ledgerId } : { outcome: "paid", ledgerId: charge.ledgerId };
  } catch (error) {
    logStepFailure("card update", "charge", error);
    if (!out) return { outcome: "error" };
    if (lookupFirst && (await abandonIfDead(repo, actor, charge.ledgerId, error).catch(() => false))) return { outcome: "error" };
    await recordOutcomeUnknown(repo, actor, memberId, charge.ledgerId, error instanceof PaymentsError ? { code: error.code } : {});
    return { outcome: "unknown" };
  }
}

/**
 * What the row is charged on and who started it: the token it holds, buyer-started, or the card on file, seller-started,
 * as the charge run's row is (DEC-053).
 */
function source(charge: PendingCharge): { sourceId: string; customerId: string; customerInitiated: boolean } {
  const sourceId = charge.chargeSource ?? charge.cardId;
  if (sourceId === null) throw new Error("The claimed row has no card token or card on file");
  return { sourceId, customerId: charge.customerId, customerInitiated: charge.chargeSource !== null };
}
