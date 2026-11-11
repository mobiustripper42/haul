import { matchCustomer, sha256Key } from "./customer-match.js";
import type { Member } from "./members.js";
import { clevelandDate, firstPickup } from "./pickup-week.js";
import { isCardRefusal, type ChargeResult, type PaymentsPort } from "./ports/payments.js";
import { SignupRefusedError, type Actor, type AuditEventDetail, type PendingSignup, type Repository } from "./ports/repository.js";
import { isSoldOut, priceOfChoices, requireSupperClub } from "./products.js";
import { errorFields, recordEventAs } from "./record-event.js";

/**
 * The Supper Club signup: a member's first week paid and a card saved (issue 56; DEC-003, DEC-004).
 * The ledger row is committed before any charge and its id, with the attempt, is the charge's
 * idempotency key, so a retry can never charge twice. The provider calls run between `withActor`
 * commits, never inside one, so a pending row survives a failed call. Everything written or recorded
 * runs under the member.
 */

/**
 * `now` is the request's start: the consent moment and the first pickup are worked out from it. `clock` is
 * read for a moment after the start, the one the paid answer came back.
 */
export type SignupDeps = { repo: Repository; payments: PaymentsPort; now: Date; clock: () => Date };

/**
 * `unknown`: the charge may or may not have happened, and the pending row stays for "Try again".
 * `sold_out`: the product's cap is reached, at the check before Square or at the card bind; nothing was charged.
 * `error`: something failed before anything was charged.
 * `confirmedNow`, on a paid result: true only when this request flipped the rows, so it is the whole guard
 * against a second confirmation email; a signup another tab confirmed first gives false.
 */
export type SignupResult = {
  outcome: "paid" | "declined" | "unknown" | "already_subscribed" | "sold_out" | "error";
  subscriptionId?: string;
  confirmedNow?: boolean;
};

/** A signup ready to charge: its pending rows, the card on the row and the member's Square customer. */
type Charge = { row: PendingSignup; productId: string; cardId: string; customerId: string; lookupFirst: boolean };

/** The retry state: charged (or about to be) on a saved card, and no answer recorded. */
const isStranded = (row: PendingSignup): row is PendingSignup & { squareCardId: string } =>
  row.ledgerStatus === "pending" && row.squareCardId !== null;

/** The log line for a failure: its name and code, never its message, which can carry the provider's text. */
function logFailure(step: string, error: unknown): void {
  console.error("signup step failed", { step, ...errorFields(error) });
}

/**
 * Signs `memberId` up: AC5's check, the Square customer, the pending rows, the card, then the charge.
 * A row already stranded on a charge takes the "Try again" path and ignores what was submitted.
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

/** "Try again": asks Square whether the charge happened, then confirms what it finds or charges the saved card. */
export async function retrySignup(deps: SignupDeps, input: { memberId: string }): Promise<SignupResult> {
  let next: SignupResult | Charge;
  try {
    next = await resume(deps, input.memberId);
  } catch (error) {
    logFailure("resume", error);
    return { outcome: "error" };
  }
  return "outcome" in next ? next : settle(deps, input.memberId, next);
}

/** The one confirm: both rows flip together, and a second run says "already". */
export async function confirmSignup(
  repo: Repository,
  input: { ledgerId: string; paymentId: string; amountCents: number; now: Date },
): Promise<"confirmed" | "already" | "mismatch"> {
  return repo.confirmSignupRows(input.ledgerId, input.paymentId, input.amountCents, input.now);
}

async function prepare(
  deps: SignupDeps,
  input: { memberId: string; choices: Record<string, string>; sourceId: string; consentText: string },
): Promise<SignupResult | Charge> {
  const { repo, payments, now } = deps;
  const actor: Actor = { member: input.memberId };
  const product = await requireSupperClub(repo);

  if (await repo.findActiveSubscription(input.memberId, product.id)) return alreadySubscribed(repo, input.memberId);
  const member = await requireMember(repo, input.memberId);

  const earlier = await repo.findPendingSignup(input.memberId, product.id);
  if (earlier && isStranded(earlier)) return stranded(member.squareCustomerId, product.id, earlier);

  // A stranded row holds its own spot, so only a signup that would take a new one meets the cap.
  if (isSoldOut(product, await repo.countHeldSpots(product.id))) return soldOut(repo, input.memberId);

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
    // Another tab got there first: the box is theirs, or their card is on the row and the rewrite is refused.
    if (!(error instanceof SignupRefusedError)) throw error;
    return (await overtaken(repo, input.memberId, product.id, customerId)) ?? raise(error);
  }

  let cardId: string;
  try {
    ({ id: cardId } = await payments.saveCard({
      customerId,
      sourceId: input.sourceId,
      idempotencyKey: sha256Key(input.sourceId),
    }));
  } catch (error) {
    // A card Square refuses to save is a decline; any other failure charged nothing and is an error.
    if (!isCardRefusal(error)) throw error;
    await recordDecline(repo, actor, input.memberId, row.ledgerId, error.code);
    return { outcome: "declined" };
  }
  // The bind returns the amount and attempt to charge: the row may have been rewritten since this tab's save.
  // It also takes the spot, and refuses when the last one went after the check above.
  const bound = await repo.withActor(actor, (scoped) => scoped.saveSubscriptionCard(row.subscriptionId, cardId));
  if (bound === "sold_out") return soldOut(repo, input.memberId);
  if (!bound) return (await overtaken(repo, input.memberId, product.id, customerId)) ?? raise(new Error("The card was not bound"));
  return {
    row: { ...row, squareCardId: cardId, amountCents: bound.amountCents, attempt: bound.attempt },
    productId: product.id,
    cardId,
    customerId,
    lookupFirst: false,
  };
}

async function resume(deps: SignupDeps, memberId: string): Promise<SignupResult | Charge> {
  const { repo } = deps;
  const product = await requireSupperClub(repo);
  if (await repo.findActiveSubscription(memberId, product.id)) return alreadySubscribed(repo, memberId);
  const member = await requireMember(repo, memberId);
  const row = await repo.findPendingSignup(memberId, product.id);
  return row && isStranded(row) ? stranded(member.squareCustomerId, product.id, row) : { outcome: "error" };
}

/** A pending row with a saved card: charge it (after asking Square), under the member's customer. */
function stranded(customerId: string | null, productId: string, row: PendingSignup & { squareCardId: string }): Charge {
  if (customerId === null) throw new Error("A saved card is on a signup whose member has no Square customer");
  return { row, productId, cardId: row.squareCardId, customerId, lookupFirst: true };
}

/**
 * What another tab left behind when this tab's save or bind lost: their box is active, or their card is on
 * the pending row and this tab takes "Try again". Null when neither is so.
 */
async function overtaken(repo: Repository, memberId: string, productId: string, customerId: string): Promise<SignupResult | Charge | null> {
  if (await repo.findActiveSubscription(memberId, productId)) return alreadySubscribed(repo, memberId);
  const row = await repo.findPendingSignup(memberId, productId);
  return row && isStranded(row) ? stranded(customerId, productId, row) : null;
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

/** The decline write: the ledger row to declined, and the event that records it, in one commit. */
async function recordDecline(repo: Repository, actor: Actor, memberId: string, ledgerId: string, code: string): Promise<void> {
  await repo.withActor(actor, async (scoped) => {
    await scoped.recordSignupDecline(ledgerId);
    await scoped.recordEvent({ kind: "card_declined", memberId, detail: { ledgerId, code } });
  });
}

/**
 * Charges, or confirms what Square already took, and writes the result. Anything that fails from here on
 * is `unknown`: the charge may have happened, the row stays pending, and "Try again" finishes it.
 */
async function settle(deps: SignupDeps, memberId: string, charge: Charge): Promise<SignupResult> {
  const { repo, payments, clock } = deps;
  const actor: Actor = { member: memberId };
  const { row } = charge;
  const unknown: AuditEventDetail = { ledgerId: row.ledgerId };
  try {
    const found = charge.lookupFirst
      ? await payments.findPaymentByReference({ referenceId: row.ledgerId, since: row.createdAt })
      : null;
    const result: ChargeResult = found ? { outcome: "paid", paymentId: found.paymentId } : await send(payments, charge);
    if (result.outcome === "declined") {
      await recordDecline(repo, actor, memberId, row.ledgerId, result.code);
      return { outcome: "declined" };
    }
    // What Square took, not what was asked: it must be the ledger's amount before anything turns active.
    const chargedCents = found ? found.amountCents : row.amountCents;
    // The paid answer is back: this is the moment `paid_at` records.
    const paidAt = clock();
    const confirmed = await repo.withActor(actor, (scoped) =>
      confirmSignup(scoped, { ledgerId: row.ledgerId, paymentId: result.paymentId, amountCents: chargedCents, now: paidAt }),
    );
    if (confirmed === "mismatch") {
      unknown.chargedCents = chargedCents;
      const ledgerCents = (await repo.findPendingSignup(memberId, charge.productId))?.amountCents;
      if (ledgerCents !== undefined) unknown.ledgerCents = ledgerCents;
      throw new Error("The charge is not the ledger's amount");
    }
    return { outcome: "paid", subscriptionId: row.subscriptionId, confirmedNow: confirmed === "confirmed" };
  } catch (error) {
    logFailure("charge", error);
    await recordEventAs(repo, actor, { kind: "charge_outcome_unknown", memberId, detail: unknown });
    return { outcome: "unknown" };
  }
}

/**
 * The charge, under the key the ledger row and its attempt make. A throw is Square giving no answer, and
 * the same key goes again once at once: a charge Square took comes back as that payment, not a second one.
 */
async function send(payments: PaymentsPort, { row, cardId, customerId }: Charge): Promise<ChargeResult> {
  const request = {
    customerId,
    cardId,
    amountCents: row.amountCents,
    idempotencyKey: `${row.ledgerId}:${row.attempt}`,
    referenceId: row.ledgerId,
  };
  try {
    return await payments.charge(request);
  } catch {
    return payments.charge(request);
  }
}
