import { createTranslator } from "./i18n.js";
import { renderEmail } from "./email-templates.js";
import { recordDecline, sendCharge } from "./ledger-charge.js";
import { formatUsdWhole } from "./money.js";
import { clevelandDate, cutoffInstant, formatPickupDate, latestCutoffWeek, pickupOver, pickupWeek, weekTitle } from "./pickup-week.js";
import type { EmailPort } from "./ports/email.js";
import { PaymentsError, type PaymentsPort } from "./ports/payments.js";
import type { Actor, AuditEventDetail, PendingCharge, Repository } from "./ports/repository.js";
import { requireSupperClub } from "./products.js";
import { errorFields, recordEventAs } from "./record-event.js";
import { deliverSignupConfirmation } from "./signup-email.js";

/**
 * The charge run (issue 134; DEC-003, DEC-004, DEC-034). Each firing writes a `pending` ledger row for every subscription
 * due the latest week whose cutoff has passed, then settles every `pending` row it can: a charge on the card on file, or,
 * where a charge must not be sent, a lookup of what Square already took. The ledger is the queue, so a firing over the
 * same state writes no second row, charges with the same key and emails once. Every write runs under
 * `CHARGE_RUN_ACTOR`, and the provider calls run between `withActor` commits, never inside one. One row's failure never
 * stops the rest.
 */

/** `now` is the firing's start; `clock` is read for the moment an answer came back, which `paid_at` records. */
export type ChargeRunDeps = {
  repo: Repository;
  payments: PaymentsPort;
  email: EmailPort;
  now: Date;
  clock: () => Date;
  siteUrl: string;
  accountUrl: string;
};

/**
 * `weekOf` is the week enrolled, null when no week's cutoff has passed; `enrolled` the rows written; `paid` the rows this
 * run's confirm answered `confirmed`, by charge or by lookup; `declined` the rows it declined; `unknown` the
 * `charge_outcome_unknown` events it recorded; `dropped` the closed weeks' rows it deleted.
 */
export type ChargeRunReport = { weekOf: string | null; enrolled: number; paid: number; declined: number; unknown: number; dropped: number };

export const CHARGE_RUN_ACTOR: Actor = { system: "charge-run" };

/** Turns the ledger into charges for the latest week whose cutoff has passed, and settles every `pending` row. */
export async function runCharges(deps: ChargeRunDeps): Promise<ChargeRunReport> {
  const { repo, now } = deps;
  const product = await requireSupperClub(repo);
  const weekOf = latestCutoffWeek(product, now);
  const report: ChargeRunReport = { weekOf, enrolled: 0, paid: 0, declined: 0, unknown: 0, dropped: 0 };
  if (weekOf !== null) {
    report.enrolled = await repo.withActor(CHARGE_RUN_ACTOR, (scoped) => scoped.enrolWeek(product.id, weekOf, cutoffInstant(product, weekOf)));
  }
  for (const row of await repo.listPendingCharges(product.id)) {
    try {
      await settle(deps, product.id, row, report);
    } catch (error) {
      logFailure("row", error);
    }
  }
  return report;
}

/** The log line for a failure: its name and code, never its message, which can carry the provider's text. */
function logFailure(step: string, error: unknown): void {
  console.error("charge run step failed", { step, ...errorFields(error) });
}

/**
 * One row. A stranded signup (its subscription still `pending`) and a closed week's row are looked up, never charged;
 * any other is charged. What Square took, however found, is confirmed; a decline is recorded; anything else leaves the row
 * `pending` and records that the outcome is unknown.
 */
async function settle(deps: ChargeRunDeps, productId: string, row: PendingCharge, report: ChargeRunReport): Promise<void> {
  const { repo, payments, clock } = deps;
  const stranded = row.subscriptionStatus === "pending";
  try {
    let paymentId: string;
    let chargedCents: number;
    if (stranded || row.closed) {
      const found = await payments.findPaymentByReference({ referenceId: row.ledgerId, since: row.createdAt });
      if (!found) {
        // A closed week's row nobody paid for is deleted once the week's pickup is over: the week is not charged.
        const last = { weekOf: row.pickupDate, firstDay: row.pickupDate, lastDay: row.lastPickupDay };
        if (!stranded && pickupOver(last, clevelandDate(deps.now)) && (await dropRow(repo, row.ledgerId))) report.dropped++;
        return;
      }
      ({ paymentId, amountCents: chargedCents } = found);
    } else {
      const result = await sendCharge(payments, { row, cardId: row.cardId, customerId: row.customerId });
      if (result.outcome === "declined") {
        await recordDecline(repo, CHARGE_RUN_ACTOR, row.memberId, row.ledgerId, result.code);
        report.declined++;
        return;
      }
      ({ paymentId } = result);
      chargedCents = row.amountCents;
    }
    // The answer is back: this is the moment `paid_at` records.
    const paidAt = clock();
    const confirmed = await repo.withActor(CHARGE_RUN_ACTOR, (scoped) => scoped.confirmSignupRows(row.ledgerId, paymentId, chargedCents, paidAt));
    if (confirmed === "mismatch") {
      // What Square took is not the ledger's amount: nothing turns paid, and nothing is emailed.
      await recordUnknown(repo, row, report, { chargedCents, ledgerCents: row.amountCents });
      return;
    }
    if (confirmed === "confirmed") {
      report.paid++;
      await sendEmail(deps, productId, row, stranded, paidAt);
    }
  } catch (error) {
    logFailure("charge", error);
    await recordUnknown(repo, row, report, error instanceof PaymentsError ? { code: error.code } : {});
  }
}

/** Deletes a closed week's unpaid row; a throw is the caller's to treat as an unknown outcome. */
function dropRow(repo: Repository, ledgerId: string): Promise<boolean> {
  return repo.withActor(CHARGE_RUN_ACTOR, (scoped) => scoped.dropClosedWeekRow(ledgerId));
}

/** The one place `charge_outcome_unknown` is written: the ledger id and whatever the case adds. */
async function recordUnknown(repo: Repository, row: PendingCharge, report: ChargeRunReport, more: AuditEventDetail): Promise<void> {
  report.unknown++;
  await recordEventAs(repo, CHARGE_RUN_ACTOR, { kind: "charge_outcome_unknown", memberId: row.memberId, detail: { ledgerId: row.ledgerId, ...more } });
}

/**
 * The email for a row this run flipped to paid: the signup confirmation for a stranded signup, the member never having
 * had one, and the receipt for any other. A failed send is logged and undoes nothing.
 */
async function sendEmail(deps: ChargeRunDeps, productId: string, row: PendingCharge, stranded: boolean, paidAt: Date): Promise<void> {
  const { repo, email, siteUrl, accountUrl } = deps;
  try {
    const member = await repo.findMemberById(row.memberId);
    if (!member) return;
    if (stranded) {
      const confirmation = await repo.findSignupConfirmation(row.memberId, productId);
      if (confirmation) await deliverSignupConfirmation(email, member, confirmation, accountUrl, siteUrl);
      return;
    }
    // The week's days as the week has them now, so a moved week is named by its moved days.
    const changed = (await repo.listChangedWeeks(productId, row.pickupDate)).find((week) => week.weekOf === row.pickupDate) ?? null;
    const week = weekTitle(createTranslator(member.language), pickupWeek(row.pickupDate, changed), member.language);
    const { subject, text } = renderEmail(
      "receipt",
      member.language,
      { amount: formatUsdWhole(row.amountCents), date: formatPickupDate(clevelandDate(paidAt), member.language), week },
      siteUrl,
    );
    await email.send({ to: member.email, subject, text });
  } catch (error) {
    logFailure("email", error);
  }
}
