import { matchCustomer, sha256Key } from "./customer-match.js";
import type { Member } from "./members.js";
import { firstPickup } from "./pickup-week.js";
import { isCardRefusal, type ChargeResult, type PaymentsPort } from "./ports/payments.js";
import type { Actor, PendingSignup, Repository } from "./ports/repository.js";
import { priceOfChoices, requireSupperClub } from "./products.js";
import { errorFields, recordEventAs } from "./record-event.js";

/**
 * The Supper Club signup: a member's first week paid and a card saved (issue 56; DEC-003, DEC-004).
 * The ledger row is committed before any charge and its id, with the attempt, is the charge's
 * idempotency key, so a retry can never charge twice. The provider calls run between `withActor`
 * commits, never inside one, so a pending row survives a failed call. Everything written or recorded
 * runs under the member.
 */

export type SignupDeps = { repo: Repository; payments: PaymentsPort; now: Date };

/**
 * `unknown`: the charge may or may not have happened, and the pending row stays for "Try again".
 * `error`: something failed before anything was charged.
 */
export type SignupResult = { outcome: "paid" | "declined" | "unknown" | "already_subscribed" | "error"; subscriptionId?: string };

/** A signup ready to charge: its pending rows, the card on the row and the member's Square customer. */
type Charge = { row: PendingSignup; cardId: string; customerId: string; lookupFirst: boolean };

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
  input: { ledgerId: string; paymentId: string; now: Date },
): Promise<"confirmed" | "already"> {
  return repo.confirmSignupRows(input.ledgerId, input.paymentId, input.now);
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
  if (earlier && isStranded(earlier)) return stranded(member, earlier);

  const customerId = member.squareCustomerId ?? (await linkCustomer(deps, member));

  const priceCents = priceOfChoices(product, input.choices);
  const row = await repo.withActor(actor, (scoped) =>
    scoped.savePendingSignup({
      memberId: input.memberId,
      productId: product.id,
      choices: input.choices,
      firstChargeCents: priceCents,
      weeklyCents: priceCents,
      pickupDate: firstPickup(product, now),
      consentText: input.consentText,
      consentAt: now,
    }),
  );

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
  await repo.withActor(actor, (scoped) => scoped.saveSubscriptionCard(row.subscriptionId, cardId));
  return { row: { ...row, squareCardId: cardId }, cardId, customerId, lookupFirst: false };
}

async function resume(deps: SignupDeps, memberId: string): Promise<SignupResult | Charge> {
  const { repo } = deps;
  const product = await requireSupperClub(repo);
  if (await repo.findActiveSubscription(memberId, product.id)) return alreadySubscribed(repo, memberId);
  const member = await requireMember(repo, memberId);
  const row = await repo.findPendingSignup(memberId, product.id);
  return row && isStranded(row) ? stranded(member, row) : { outcome: "error" };
}

/** A pending row with a saved card: charge it (after asking Square), under the member's customer. */
function stranded(member: Member, row: PendingSignup & { squareCardId: string }): Charge {
  if (member.squareCustomerId === null) throw new Error("A saved card is on a signup whose member has no Square customer");
  return { row, cardId: row.squareCardId, customerId: member.squareCustomerId, lookupFirst: true };
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
  const { repo, payments, now } = deps;
  const actor: Actor = { member: memberId };
  const { row } = charge;
  try {
    const found = charge.lookupFirst
      ? await payments.findPaymentByReference({ referenceId: row.ledgerId, since: row.createdAt })
      : null;
    const result: ChargeResult = found ? { outcome: "paid", paymentId: found.paymentId } : await send(payments, charge);
    if (result.outcome === "declined") {
      await recordDecline(repo, actor, memberId, row.ledgerId, result.code);
      return { outcome: "declined" };
    }
    await repo.withActor(actor, (scoped) => confirmSignup(scoped, { ledgerId: row.ledgerId, paymentId: result.paymentId, now }));
    return { outcome: "paid", subscriptionId: row.subscriptionId };
  } catch (error) {
    logFailure("charge", error);
    await recordEventAs(repo, actor, { kind: "charge_outcome_unknown", memberId, detail: { ledgerId: row.ledgerId } });
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
