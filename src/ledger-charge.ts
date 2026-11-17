import { renderEmail } from "./email-templates.js";
import { createTranslator, type Language } from "./i18n.js";
import type { Member } from "./members.js";
import { formatUsdWhole } from "./money.js";
import { clevelandDate, formatPickupDate, pickupWeek, weekTitle } from "./pickup-week.js";
import type { EmailPort } from "./ports/email.js";
import type { ChargeResult, PaymentsPort } from "./ports/payments.js";
import type { Actor, AuditEventDetail, Repository } from "./ports/repository.js";
import { errorFields, recordEventAs } from "./record-event.js";

/**
 * What a ledger row's charge is made of, shared by the signup (`src/signup.ts`) and the charge run
 * (`src/charge-run.ts`) and the card update (`src/update-card.ts`): one home for the key a row and its attempt make, the
 * decline write, the unknown-outcome write, and the receipt and the try-and-log email send.
 */

/**
 * The decline write: the ledger row to declined, and the event that records it, in one commit. True when this
 * call turned the row declined; false when it was no longer pending, so the caller does not act on it twice.
 */
export async function recordDecline(repo: Repository, actor: Actor, memberId: string, ledgerId: string, code: string): Promise<boolean> {
  return repo.withActor(actor, async (scoped) => {
    const flipped = await scoped.recordSignupDecline(ledgerId);
    await scoped.recordEvent({ kind: "card_declined", memberId, detail: { ledgerId, code } });
    return flipped;
  });
}

/**
 * The charge, under the key the ledger row and its attempt make. A throw is Square giving no answer, and
 * the same key goes again once at once: a charge Square took comes back as that payment, not a second one.
 */
export async function sendCharge(
  payments: PaymentsPort,
  { row, cardId, customerId }: { row: { ledgerId: string; attempt: number; amountCents: number }; cardId: string; customerId: string },
): Promise<ChargeResult> {
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
