import { matchCustomer } from "./customer-match.js";
import { recordDecline, settlePaid, takeCharge } from "./ledger-charge.js";
import type { Member } from "./members.js";
import { clevelandDate, firstPickup } from "./pickup-week.js";
import { PaymentsError, requireCardToken, type PaymentsPort } from "./ports/payments.js";
import { SignupRefusedError, type Actor, type AuditEventDetail, type PendingSignup, type Repository } from "./ports/repository.js";
import { isSoldOut, priceOfChoices, requireSupperClub } from "./products.js";
import { errorFields, recordEventAs } from "./record-event.js";

/**
 * The Supper Club signup: a member's first week paid and a card saved (issue 56; DEC-003, DEC-004, DEC-053).
 * The ledger row is committed before any charge and its id, with the attempt, is the charge's
 * idempotency key, so a second submit can never charge twice. The row holds the moment its charge was sent while the charge
 * is out, the card token is charged buyer-started and kept nowhere, and the card is saved from the payment. A submit over
 * a charge that is out charges the card it brings under the same key (`takeCharge`). The provider calls run between
 * `withActor` commits, never inside one, so a pending row survives a failed call. Everything written or recorded
 * runs under the member.
 */

/**
 * `now` is the request's start: the consent moment and the first pickup are worked out from it. `clock` is
 * read for a moment after the start, the one the paid answer came back.
 */
export type SignupDeps = { repo: Repository; payments: PaymentsPort; now: Date; clock: () => Date };

/**
 * `unknown`: the charge may or may not have happened, and the pending row stays out for the member's next submit.
 * `sold_out`: the product's cap is reached, at the check before Square or at the charge's start; nothing was charged.
 * `error`: something failed before anything was charged, or Square refused the charge outright and the member enters the card again.
 * `confirmedNow`, on a paid result: true only when this request flipped the rows, so it is the whole guard
 * against a second confirmation email; a signup another tab confirmed first gives false.
 */
export type SignupResult = {
  outcome: "paid" | "declined" | "unknown" | "already_subscribed" | "sold_out" | "error";
  subscriptionId?: string;
  confirmedNow?: boolean;
};

/**
 * A signup ready to charge: its pending row with its charge out, the card the member just entered and the member's Square
 * customer. `first`: this submit started the charge, so it goes at once; otherwise it is over one that was out.
 */
type Charge = { row: PendingSignup & { chargeSentAt: Date }; productId: string; sourceId: string; customerId: string; first: boolean };

/** Whether the row's charge is out: a charge the member sent has no recorded answer, so `charge_sent_at` is set. The one home for "charge out". */
export function isChargeOut<T extends { chargeSentAt: Date | null }>(row: T): row is T & { chargeSentAt: Date } {
  return row.chargeSentAt !== null;
}

/** The log line for a failure: its name and code, never its message, which can carry the provider's text. */
function logFailure(step: string, error: unknown): void {
  console.error("signup step failed", { step, ...errorFields(error) });
}

/**
 * Signs `memberId` up: AC5's check, the Square customer, the pending rows, the charge marked sent on the row, then the
 * charge and the card saved from it. A row whose charge is already out is charged the new card under the same key, for its
 * own amount and picks: what was submitted with it is ignored.
 */
export async function signUp(
  deps: SignupDeps,
  input: { memberId: string; choices: Record<string, string>; sourceId: string; consentText: string },
): Promise<SignupResult> {
  let next: SignupResult | Charge;
  try {
    next = await prepare(deps, input);
  } catch (error) {
    logFailure("prepare", error);
    return { outcome: "error" };
  }
  return "outcome" in next ? next : settle(deps, input.memberId, next);
}

async function prepare(
  deps: SignupDeps,
  input: { memberId: string; choices: Record<string, string>; sourceId: string; consentText: string },
): Promise<SignupResult | Charge> {
  const { repo, now } = deps;
  const actor: Actor = { member: input.memberId };
  const product = await requireSupperClub(repo);

  if (await repo.findActiveSubscription(input.memberId, product.id)) return alreadySubscribed(repo, input.memberId);
  const member = await requireMember(repo, input.memberId);

  const earlier = await repo.findPendingSignup(input.memberId, product.id);
  if (earlier && isChargeOut(earlier)) {
    // A blank token, or CASH or EXTERNAL, is an error before Square is asked anything.
    requireCardToken(input.sourceId);
    return charging(member.squareCustomerId, product.id, earlier, input.sourceId);
  }

  // A row whose charge is out holds its own spot, so only a signup that would take a new one meets the cap.
  if (isSoldOut(product, await repo.countHeldSpots(product.id))) return soldOut(repo, input.memberId);
  // A blank token, or CASH or EXTERNAL, is an error before anything is written or sent.
  requireCardToken(input.sourceId);

  const customerId = member.squareCustomerId ?? (await linkCustomer(deps, member));

  const priceCents = priceOfChoices(product, input.choices);
  const changed = await repo.listChangedWeeks(product.id, clevelandDate(now));
  let row: PendingSignup;
  try {
    row = await repo.withActor(actor, (scoped) =>
      scoped.savePendingSignup({
        memberId: input.memberId,
        productId: product.id,
        choices: input.choices,
        firstChargeCents: priceCents,
        weeklyCents: priceCents,
        pickupDate: firstPickup(product, now, changed).weekOf,
        consentText: input.consentText,
        consentAt: now,
      }),
    );
  } catch (error) {
    // Another tab got there first: the box is theirs, or their charge is out on the row and the rewrite is refused.
    if (!(error instanceof SignupRefusedError)) throw error;
    return (await overtaken(repo, input.memberId, product.id, customerId, input.sourceId)) ?? raise(error);
  }

  // The charge is marked sent on the row: it is out from here. It returns the amount and attempt to charge, since the row
  // may have been rewritten since this tab's save. It also takes the spot, and refuses when the last one went after the check above.
  const sentAt = deps.clock();
  const bound = await repo.withActor(actor, (scoped) => scoped.startSignupCharge(row.subscriptionId, sentAt));
  if (bound === "sold_out") return soldOut(repo, input.memberId);
  if (!bound) return (await overtaken(repo, input.memberId, product.id, customerId, input.sourceId)) ?? raise(new Error("The charge was not marked sent on the row"));
  return {
    row: { ...row, chargeSentAt: sentAt, amountCents: bound.amountCents, attempt: bound.attempt },
    productId: product.id,
    sourceId: input.sourceId,
    customerId,
    first: true,
  };
}

/** A pending row whose charge is out: this submit's card is charged over it, under the member's customer. */
function charging(customerId: string | null, productId: string, row: PendingSignup & { chargeSentAt: Date }, sourceId: string): Charge {
  if (customerId === null) throw new Error("A charge is out on a signup whose member has no Square customer");
  return { row, productId, sourceId, customerId, first: false };
}

/**
 * What another tab left behind when this tab's save or start lost: their box is active, or their charge is out on
 * the pending row and this tab's card is charged over it. Null when neither is so.
 */
async function overtaken(repo: Repository, memberId: string, productId: string, customerId: string, sourceId: string): Promise<SignupResult | Charge | null> {
  if (await repo.findActiveSubscription(memberId, productId)) return alreadySubscribed(repo, memberId);
  const row = await repo.findPendingSignup(memberId, productId);
  return row && isChargeOut(row) ? charging(customerId, productId, row, sourceId) : null;
}

function raise(error: unknown): never {
  throw error;
}

async function requireMember(repo: Repository, memberId: string): Promise<Member> {
  const member = await repo.findMemberById(memberId);
  if (!member) throw new Error("signUp: the member is gone");
  return member;
}

async function alreadySubscribed(repo: Repository, memberId: string): Promise<SignupResult> {
  await recordEventAs(repo, { member: memberId }, { kind: "already_subscribed", memberId });
  return { outcome: "already_subscribed" };
}

async function soldOut(repo: Repository, memberId: string): Promise<SignupResult> {
  await recordEventAs(repo, { member: memberId }, { kind: "sold_out", memberId });
  return { outcome: "sold_out" };
}

/**
 * Finds the member's Square customer by email or creates one (email only, the member id as its reference),
 * and stores its id. A link to an existing customer is recorded: the decision is made above the write
 * (DEC-028), as is a match with several, whose rest the farm merges in Square.
 */
async function linkCustomer(deps: SignupDeps, member: Member): Promise<string> {
  const { repo, payments } = deps;
  const match = await matchCustomer(payments, { email: member.email, referenceId: member.id });
  if (match.outcome === "linked") {
    await payments.setCustomerReference({ customerId: match.customerId, referenceId: member.id });
  }
  await repo.withActor({ member: member.id }, async (scoped) => {
    await scoped.setMemberSquareCustomer(member.id, match.customerId);
    if (match.outcome === "linked") {
      await scoped.recordEvent({ kind: "square_customer_linked", memberId: member.id, detail: { customerId: match.customerId } });
      if (match.duplicates.length > 0) {
        await scoped.recordEvent({ kind: "square_customer_duplicates", memberId: member.id, detail: { customerIds: match.duplicates } });
      }
    }
  });
  return match.customerId;
}

/**
 * Takes the charge (`takeCharge`: the first send, or the submit over the one that is out), saves the card from the payment
 * and writes the result. Anything that fails from here on is `unknown`: the charge may have happened, the row stays out, and
 * the member's next submit finishes it. The one exception is a charge Square refuses outright (`refused`): it ends, and the
 * member is sent back to the form (`error`).
 */
async function settle(deps: SignupDeps, memberId: string, charge: Charge): Promise<SignupResult> {
  const { repo, payments, clock } = deps;
  const actor: Actor = { member: memberId };
  const { row } = charge;
  const unknown: AuditEventDetail = { ledgerId: row.ledgerId };

  const finish = async (): Promise<SignupResult | { unknown: unknown }> => {
    const taken = await takeCharge(repo, payments, actor, { row, first: charge.first, sourceId: charge.sourceId, customerId: charge.customerId, clock });
    if (taken.outcome === "refused") return { outcome: "error" };
    if (taken.outcome === "unknown") return { unknown: taken.error };
    if (taken.outcome === "declined") {
      await recordDecline(repo, actor, memberId, row.ledgerId, taken.code, taken.attempt);
      return { outcome: "declined" };
    }
    // What Square took, not what was asked: it must be the ledger's amount before anything turns active.
    const chargedCents = taken.amountCents;
    // The paid answer is back: this is the moment `paid_at` records.
    const paidAt = clock();
    const { confirmed } = await settlePaid(repo, payments, actor, {
      ledgerId: row.ledgerId,
      paymentId: taken.paymentId,
      amountCents: chargedCents,
      customerId: charge.customerId,
      memberId,
      paidAt,
    });
    if (confirmed === "mismatch") {
      unknown.chargedCents = chargedCents;
      const ledgerCents = (await repo.findPendingSignup(memberId, charge.productId))?.amountCents;
      if (ledgerCents !== undefined) unknown.ledgerCents = ledgerCents;
      throw new Error("The charge is not the ledger's amount");
    }
    return { outcome: "paid", subscriptionId: row.subscriptionId, confirmedNow: confirmed === "confirmed" };
  };

  let answer: SignupResult | { unknown: unknown };
  try {
    answer = await finish();
  } catch (error) {
    answer = { unknown: error };
  }
  if (!("unknown" in answer)) return answer;
  if (answer.unknown !== undefined) logFailure("charge", answer.unknown);
  if (answer.unknown instanceof PaymentsError) unknown.code = answer.unknown.code;
  await recordEventAs(repo, actor, { kind: "charge_outcome_unknown", memberId, detail: unknown });
  return { outcome: "unknown" };
}
