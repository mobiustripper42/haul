import { sha256Key } from "./customer-match.js";
import { logStepFailure, recordDecline, recordOutcomeUnknown, renderReceipt, sendMemberEmail, settlePaid, takeCharge } from "./ledger-charge.js";
import type { EmailPort } from "./ports/email.js";
import { isCardRefusal, PaymentsError, requireCardToken, type Card, type PaymentsPort } from "./ports/payments.js";
import type { Actor, PendingCharge, Repository } from "./ports/repository.js";
import { requireSupperClub } from "./products.js";
import { recordEventAs } from "./record-event.js";
import { isChargeOut } from "./signup.js";

/**
 * A member's card update (issue 145; DEC-003, DEC-053): with a declined week owed, the claim marks its row's charge sent,
 * and the row stays `declined`; the card the member entered is charged under the key its bumped attempt makes, and the card
 * is saved from the payment. With nothing owed the card is saved alone. The key stays fixed until that charge settles, by
 * the member's next save (the card it brings is charged under the same key, `takeCharge`), or by a firing of the charge run
 * that finds Square took it (the run never sends it), so a save while any row is `pending` or has its charge out saves no
 * card. The provider calls run between `withActor` commits, never inside one. Everything written or recorded runs under the
 * member.
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
 * declined card is taken off file and nothing charges it again. `declined`: Square refused the card, or the week's charge was
 * declined (the old card stays on file, the row has no charge out and stays declined). `unknown`: the week's charge got no
 * answer, or a charge the member did not send was in the way, and the member's next save finishes it. `error`: something
 * failed before any charge was sent, or Square refused the charge outright and the member enters the card again.
 */
export async function updateCard(deps: UpdateCardDeps, input: { memberId: string; sourceId: string }): Promise<UpdateCardResult> {
  try {
    return await save(deps, input);
  } catch (error) {
    logStepFailure("card update", "update", error);
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

  const claim = await repo.withActor(actor, (scoped) => scoped.claimCardUpdate(subscription.id, deps.clock()));
  switch (claim.kind) {
    case "claimed":
      return settle(deps, memberId, product.id, claim.charge, true, sourceId);
    case "out":
      return settle(deps, memberId, product.id, claim.charge, false, sourceId);
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

/**
 * Takes the claimed row's charge (`takeCharge`: the first send, or the save over the charge that is out), saves the card
 * from the payment and writes the result: paid, declined through the signup's decline write, or unknown with the row left
 * out. A failure anywhere is `unknown` and recorded, with Square's code when it has one; a charge Square refuses outright
 * is `error`, and the row stays as it was, declined.
 */
async function settle(deps: UpdateCardDeps, memberId: string, productId: string, row: PendingCharge, first: boolean, sourceId: string): Promise<UpdateCardResult> {
  const { repo, payments, clock } = deps;
  const actor: Actor = { member: memberId };

  const finish = async (): Promise<UpdateCardResult | { unknown: unknown }> => {
    if (!isChargeOut(row)) throw new Error("The row to charge has no charge out");
    const taken = await takeCharge(repo, payments, actor, { row, first, sourceId, customerId: row.customerId, clock });
    if (taken.outcome === "refused") return { outcome: "error" };
    if (taken.outcome === "unknown") return { unknown: taken.error };
    if (taken.outcome === "declined") {
      await recordDecline(repo, actor, memberId, row.ledgerId, taken.code, taken.attempt);
      return { outcome: "declined" };
    }
    // What Square took, not what was asked: it must be the ledger's amount before the row turns paid.
    const chargedCents = taken.amountCents;
    // The answer is back: this is the moment `paid_at` records.
    const paidAt = clock();
    const { confirmed, cardSaved } = await settlePaid(repo, payments, actor, {
      ledgerId: row.ledgerId,
      paymentId: taken.paymentId,
      amountCents: chargedCents,
      customerId: row.customerId,
      memberId,
      paidAt,
    });
    if (confirmed === "mismatch") {
      await recordOutcomeUnknown(repo, actor, memberId, row.ledgerId, { chargedCents });
      return { outcome: "unknown" };
    }
    // Only the call that turned the row paid emails: a row already paid has had its receipt, whether or not the card was saved.
    if (confirmed === "confirmed") {
      await sendMemberEmail(deps, "card update", memberId, (member) => renderReceipt(repo, productId, row, paidAt, member, deps.siteUrl));
    }
    return confirmed === "confirmed" && !cardSaved ? { outcome: "paidNoCard", ledgerId: row.ledgerId } : { outcome: "paid", ledgerId: row.ledgerId };
  };

  let answer: UpdateCardResult | { unknown: unknown };
  try {
    answer = await finish();
  } catch (error) {
    answer = { unknown: error };
  }
  if (!("unknown" in answer)) return answer;
  if (answer.unknown !== undefined) logStepFailure("card update", "charge", answer.unknown);
  await recordOutcomeUnknown(repo, actor, memberId, row.ledgerId, answer.unknown instanceof PaymentsError ? { code: answer.unknown.code } : {});
  return { outcome: "unknown" };
}
