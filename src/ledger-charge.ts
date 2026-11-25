import { sha256Key } from "./customer-match.js";
import { renderEmail } from "./email-templates.js";
import { createTranslator, type Language } from "./i18n.js";
import type { Member } from "./members.js";
import { formatUsdWhole } from "./money.js";
import { clevelandDate, formatPickupDate, pickupWeek, weekTitle } from "./pickup-week.js";
import type { EmailPort } from "./ports/email.js";
import { IdempotencyKeyReusedError, isRefusedCharge, PaymentsError, type Card, type ChargeResult, type PaymentsPort } from "./ports/payments.js";
import type { Actor, AuditEventDetail, Repository } from "./ports/repository.js";
import { errorFields, recordEventAs } from "./record-event.js";

/**
 * What a ledger row's charge is made of, shared by the signup (`src/signup.ts`) and the charge run
 * (`src/charge-run.ts`) and the card update (`src/update-card.ts`): one home for the key a row and its attempt make, the
 * decline write, the unknown-outcome write, and the receipt and the try-and-log email send.
 */

/**
 * The decline write: the ledger row to declined at `attempt`, and the event that records it, in one commit. True when this
 * call turned the row declined; false when it was no longer pending or its charge was another attempt's, so the caller
 * does not act on it twice.
 */
export async function recordDecline(repo: Repository, actor: Actor, memberId: string, ledgerId: string, code: string, attempt: number): Promise<boolean> {
  return repo.withActor(actor, async (scoped) => {
    const flipped = await scoped.recordSignupDecline(ledgerId, attempt);
    await scoped.recordEvent({ kind: "card_declined", memberId, detail: { ledgerId, code } });
    return flipped;
  });
}

/**
 * The charge, under the key the ledger row and its attempt make. `sourceId` is a card token or a saved card's id, and
 * `customerInitiated` says whether the member started it. A throw is Square giving no answer, and the same key goes again
 * once at once: a charge Square took comes back as that payment, not a second one. A refused charge (`isRefusedCharge`) is
 * never resent: it throws at once. When the first try failed some other way and the resend is refused, the first failure
 * is thrown, because the first try may be what used the token.
 */
export async function sendCharge(
  payments: PaymentsPort,
  {
    row,
    sourceId,
    customerId,
    customerInitiated,
  }: {
    row: { ledgerId: string; attempt: number; amountCents: number };
    sourceId: string;
    customerId: string;
    customerInitiated: boolean;
  },
): Promise<ChargeResult> {
  const request = {
    customerId,
    sourceId,
    amountCents: row.amountCents,
    idempotencyKey: `${row.ledgerId}:${row.attempt}`,
    referenceId: row.ledgerId,
    customerInitiated,
  };
  try {
    return await payments.charge(request);
  } catch (first) {
    if (isRefusedCharge(first)) throw first;
    try {
      return await payments.charge(request);
    } catch (second) {
      throw isRefusedCharge(second) ? first : second;
    }
  }
}

/**
 * The paid step a token's charge shares (DEC-053): the card saved from the payment, then the one confirm that puts it on
 * file and turns the rows paid. A save that fails for any reason confirms the rows without a card, and records
 * `card_not_saved` when that confirm is the one that turned them; the member enters the card again. The charge Square took
 * is paid either way, so nothing here rejects for a card.
 */
export async function settlePaid(
  repo: Repository,
  payments: PaymentsPort,
  actor: Actor,
  paid: { ledgerId: string; paymentId: string; amountCents: number; customerId: string; memberId: string; paidAt: Date },
): Promise<{ confirmed: "confirmed" | "already" | "mismatch"; cardSaved: boolean }> {
  const { ledgerId, paymentId, amountCents, customerId, memberId, paidAt } = paid;
  let card: Card | undefined;
  let failure: unknown;
  try {
    card = await payments.saveCard({ customerId, sourceId: paymentId, idempotencyKey: sha256Key(paymentId) });
  } catch (error) {
    failure = error;
    logStepFailure("card save", "save", error);
  }
  const confirmed = await repo.withActor(actor, async (scoped) => {
    const answer = card
      ? await scoped.confirmSignupRows(ledgerId, paymentId, amountCents, paidAt, card)
      : await scoped.confirmSignupRows(ledgerId, paymentId, amountCents, paidAt);
    if (!card && answer === "confirmed") {
      const code = failure instanceof PaymentsError ? { code: failure.code } : {};
      await scoped.recordEvent({ kind: "card_not_saved", memberId, detail: { ledgerId, paymentId, ...code } });
    }
    return answer;
  });
  return { confirmed, cardSaved: card !== undefined };
}

/** How long after a charge was sent a submit may go to the next key: longer than a server request can live, so no earlier send is still on its way. */
export const RESEND_AFTER_MS = 600_000;

/** What takeCharge gives back: what Square said, or `refused` once the charge is ended, or `unknown` with the charge still out. */
export type TakenCharge =
  | { outcome: "paid"; paymentId: string; amountCents: number }
  | { outcome: "declined"; code: string; attempt: number }
  | { outcome: "refused" }
  | { outcome: "unknown"; error?: unknown };

const unknown = (error?: unknown): TakenCharge => (error === undefined ? { outcome: "unknown" } : { outcome: "unknown", error });

type Write<T> = { done: true; value: T } | { done: false; error: unknown };

/** A write under the actor, whose failure is an answer and not a throw: every write here that fails leaves the charge out, as `unknown`. */
async function tryWrite<T>(repo: Repository, actor: Actor, write: (scoped: Repository) => Promise<T>): Promise<Write<T>> {
  try {
    return { done: true, value: await repo.withActor(actor, write) };
  } catch (error) {
    return { done: false, error };
  }
}

/** One send of the card, under the key `attempt` makes, as what became of it. */
async function send(
  payments: PaymentsPort,
  row: { ledgerId: string; amountCents: number },
  attempt: number,
  sourceId: string,
  customerId: string,
): Promise<ChargeResult | { outcome: "reused" | "refused" | "no_answer"; error: unknown }> {
  try {
    return await sendCharge(payments, { row: { ...row, attempt }, sourceId, customerId, customerInitiated: true });
  } catch (error) {
    if (error instanceof IdempotencyKeyReusedError) return { outcome: "reused", error };
    return { outcome: isRefusedCharge(error) ? "refused" : "no_answer", error };
  }
}

/**
 * A member's charge of the card just entered, over a row whose charge is out (DEC-053): the signup's and the card update's
 * one home for the rule. `first`: the charge was marked sent by this submit (`startSignupCharge`, the claim), and goes at
 * once under the key `ledgerId:attempt`. Otherwise another charge is out: Square is asked for a payment under the ledger
 * id, and one found is the answer (`paid`, no charge sent); none found, this submit takes the charge over
 * (`markChargeSent`) and sends the card under the same key. A key Square has seen is the next key only when the lookup
 * began `RESEND_AFTER_MS` or more after the stamp the row was read with, the earlier charge then being neither on its way
 * nor among Square's payments (`restartCharge`); else the mark is put back. A charge Square refuses outright ends this
 * submit's charge, as `refused`: the first charge of an attempt is abandoned, a taken-over one has its mark put back, the
 * charge before it being still unknown. Every write names the charge it means by attempt and stamp, so a write that finds
 * another submit's charge leaves it, as `unknown`, with nothing more sent. The writes are the actor's; each stamp is read
 * from `clock` at its moment. The caller writes what `paid` and `declined` mean.
 */
export async function takeCharge(
  repo: Repository,
  payments: PaymentsPort,
  actor: Actor,
  charge: {
    row: { ledgerId: string; attempt: number; amountCents: number; createdAt: Date; chargeSentAt: Date };
    first: boolean;
    sourceId: string;
    customerId: string;
    clock: () => Date;
  },
): Promise<TakenCharge> {
  const { row, first, sourceId, customerId, clock } = charge;

  /** Square's answer to the first charge of an attempt, which is out since `sentAt`: only a refusal ends it. */
  const firstOfAttempt = async (attempt: number, sentAt: Date): Promise<TakenCharge> => {
    const sent = await send(payments, row, attempt, sourceId, customerId);
    switch (sent.outcome) {
      case "paid":
        return { outcome: "paid", paymentId: sent.paymentId, amountCents: row.amountCents };
      case "declined":
        return { outcome: "declined", code: sent.code, attempt };
      case "refused": {
        const ended = await tryWrite(repo, actor, (scoped) => scoped.abandonCharge(row.ledgerId, sentAt));
        return ended.done && ended.value !== null ? { outcome: "refused" } : unknown(ended.done ? sent.error : ended.error);
      }
      default:
        return unknown(sent.error);
    }
  };

  if (first) return firstOfAttempt(row.attempt, row.chargeSentAt);

  const lookupStartedAt = clock();
  let found;
  try {
    found = await payments.findPaymentByReference({ referenceId: row.ledgerId, since: row.createdAt });
  } catch (error) {
    return unknown(error);
  }
  if (found) return { outcome: "paid", paymentId: found.paymentId, amountCents: found.amountCents };

  const marked = await tryWrite(repo, actor, (scoped) => scoped.markChargeSent(row.ledgerId, row.attempt, row.chargeSentAt, clock()));
  if (!marked.done) return unknown(marked.error);
  const mark = marked.value;
  if (mark === null) return unknown();

  /** This submit's mark goes back to the stamp the row was read with; false when another submit has taken the charge over since. */
  const putBack = async (): Promise<Write<boolean>> =>
    tryWrite(repo, actor, (scoped) => scoped.restoreChargeSent(row.ledgerId, row.attempt, mark, row.chargeSentAt));

  const sent = await send(payments, row, row.attempt, sourceId, customerId);
  switch (sent.outcome) {
    case "paid":
      return { outcome: "paid", paymentId: sent.paymentId, amountCents: row.amountCents };
    case "declined":
      return { outcome: "declined", code: sent.code, attempt: row.attempt };
    case "refused": {
      const restored = await putBack();
      return restored.done && restored.value ? { outcome: "refused" } : unknown(restored.done ? sent.error : restored.error);
    }
    case "reused": {
      if (lookupStartedAt.getTime() - row.chargeSentAt.getTime() < RESEND_AFTER_MS) {
        const restored = await putBack();
        return unknown(restored.done ? sent.error : restored.error);
      }
      const restarted = await tryWrite(repo, actor, (scoped) => scoped.restartCharge(row.ledgerId, row.attempt, mark, clock()));
      if (!restarted.done) return unknown(restarted.error);
      if (restarted.value === null) return unknown(sent.error);
      return firstOfAttempt(restarted.value.attempt, restarted.value.sentAt);
    }
    default:
      return unknown(sent.error);
  }
}

/** The one place `charge_outcome_unknown` is written: the ledger id and whatever the case adds. */
export async function recordOutcomeUnknown(
  repo: Repository,
  actor: Actor,
  memberId: string,
  ledgerId: string,
  more: AuditEventDetail,
): Promise<void> {
  await recordEventAs(repo, actor, { kind: "charge_outcome_unknown", memberId, detail: { ledgerId, ...more } });
}

/** The log line for a failed step of `source`: its name and code, never its message, which can carry the provider's text. */
export function logStepFailure(source: string, step: string, error: unknown): void {
  console.error(`${source} step failed`, { step, ...errorFields(error) });
}

/**
 * Finds the member, renders the email for them and sends it. A member who is gone gets none; a failed step or send is
 * logged and undoes nothing. The one home for the try-and-log sends.
 */
export async function sendMemberEmail(
  deps: { repo: Repository; email: EmailPort },
  source: string,
  memberId: string,
  render: (member: Member) => Promise<{ subject: string; text: string } | null>,
): Promise<void> {
  try {
    const member = await deps.repo.findMemberById(memberId);
    if (!member) return;
    const message = await render(member);
    if (message) await deps.email.send({ to: member.email, subject: message.subject, text: message.text });
  } catch (error) {
    logStepFailure(source, "email", error);
  }
}

/** The week's title in `language`, the week's days as the week has them now, so a moved week is named by its moved days. */
export async function weekNamed(repo: Repository, productId: string, pickupDate: string, language: Language): Promise<string> {
  const changed = (await repo.listChangedWeeks(productId, pickupDate)).find((week) => week.weekOf === pickupDate) ?? null;
  return weekTitle(createTranslator(language), pickupWeek(pickupDate, changed), language);
}

/** The receipt for a week paid: the amount, the day it was charged and the week's days. */
export async function renderReceipt(
  repo: Repository,
  productId: string,
  row: { pickupDate: string; amountCents: number },
  paidAt: Date,
  member: Member,
  siteUrl: string,
): Promise<{ subject: string; text: string }> {
  const week = await weekNamed(repo, productId, row.pickupDate, member.language);
  return renderEmail(
    "receipt",
    member.language,
    { amount: formatUsdWhole(row.amountCents), date: formatPickupDate(clevelandDate(paidAt), member.language), week },
    siteUrl,
  );
}
