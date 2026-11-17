import { renderEmail } from "./email-templates.js";
import { logStepFailure, recordDecline, recordOutcomeUnknown, renderReceipt, sendCharge, sendMemberEmail as sendEmailTo, weekNamed } from "./ledger-charge.js";
import { formatUsdWhole } from "./money.js";
import { clevelandDate, cutoffInstant, latestCutoffWeek, pickupOver } from "./pickup-week.js";
import type { Member } from "./members.js";
import type { EmailPort } from "./ports/email.js";
import { PaymentsError, type PaymentsPort } from "./ports/payments.js";
import type { Actor, AuditEventDetail, PendingCharge, Repository } from "./ports/repository.js";
import { requireSupperClub } from "./products.js";
import { deliverSignupConfirmation } from "./signup-email.js";

/**
 * The charge run (issue 134; DEC-003, DEC-004, DEC-034, DEC-035). Each firing writes a ledger row for every subscription
 * due the latest week whose cutoff has passed: `pending` to charge, or (issue 150) `paid` at 0 cents where a week credit
 * paid the week, which its member is emailed, or its picks sum to 0 cents. It then settles every `pending` row it can: a charge on the card on file, or,
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
  /** Where the decline email sends the member to update their card. */
  cardUrl: string;
};

/**
 * `weekOf` is the week enrolled, null when no week's cutoff has passed; `enrolled` the rows written; `paid` the rows this
 * run's confirm answered `confirmed`, by charge or by lookup; `declined` the rows it declined; `unknown` the
 * `charge_outcome_unknown` events it recorded; `dropped` the closed weeks' rows it deleted; `skipped` that the firing found
 * another's lease held and did nothing; `locked` (issue 196) the rows it wrote `locked`, a subset of `enrolled`.
 */
export type ChargeRunReport = {
  weekOf: string | null;
  enrolled: number;
  paid: number;
  declined: number;
  unknown: number;
  dropped: number;
  skipped: boolean;
  locked: number;
};

export const CHARGE_RUN_ACTOR: Actor = { system: "charge-run" };

/** How long a firing's lease lasts from its claim (issue 174; DEC-038): past it, a firing that never released is presumed dead. */
export const CHARGE_RUN_LEASE_MS = 30 * 60_000;
/** The name the charge run's lease is held under. */
export const CHARGE_RUN_LEASE = "charge-run";

/** The report with every count 0: the run's starting point, and what a skipped firing returns. */
function zeroReport(weekOf: string | null, skipped: boolean): ChargeRunReport {
  return { weekOf, enrolled: 0, paid: 0, declined: 0, unknown: 0, dropped: 0, skipped, locked: 0 };
}

/**
 * Turns the ledger into charges for the latest week whose cutoff has passed, and settles every `pending` row. One firing
 * at a time (issue 174; DEC-038): it claims the run's lease before anything else, and a firing that finds it held does
 * nothing and reports `skipped`. The lease is released once the body ends, however it ends.
 */
export async function runCharges(deps: ChargeRunDeps): Promise<ChargeRunReport> {
  const { repo, clock } = deps;
  const at = clock();
  const token = await repo.claimRunLease(CHARGE_RUN_LEASE, at, new Date(at.getTime() + CHARGE_RUN_LEASE_MS));
  if (token === null) return zeroReport(null, true);
  try {
    return await chargeRunBody(deps);
  } finally {
    await repo.releaseRunLease(CHARGE_RUN_LEASE, token);
  }
}

async function chargeRunBody(deps: ChargeRunDeps): Promise<ChargeRunReport> {
  const { repo, now } = deps;
  const product = await requireSupperClub(repo);
  const weekOf = latestCutoffWeek(product, now);
  const report = zeroReport(weekOf, false);
  if (weekOf !== null) {
    const enrolled = await repo.withActor(CHARGE_RUN_ACTOR, (scoped) => scoped.enrolWeek(product.id, weekOf, cutoffInstant(product, weekOf)));
    report.enrolled = enrolled.pending + enrolled.zeroCents + enrolled.byWeekCredit.length + enrolled.locked.length;
    report.locked = enrolled.locked.length;
    // After the commit, as the receipt is: a row paid by a week credit is paid, and its member is told so.
    for (const row of enrolled.byWeekCredit) await sendWeekCreditReceipt(deps, product.id, weekOf, row.memberId);
    // Issue 196: a locked week is told the same way: its member's card is still declined and no meal is coming.
    for (const row of enrolled.locked) await sendLockedNotice(deps, product.id, weekOf, row.memberId);
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
  logStepFailure("charge run", step, error);
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
        const flipped = await recordDecline(repo, CHARGE_RUN_ACTOR, row.memberId, row.ledgerId, result.code);
        report.declined++;
        // Only the firing that turned the row declined emails: a loser of the race has nothing to tell the member.
        if (flipped) {
          await sendMemberEmail(deps, row.memberId, async (member) => {
            const week = await weekNamed(repo, productId, row.pickupDate, member.language);
            return renderEmail(
              "cardDeclined",
              member.language,
              { week, amount: formatUsdWhole(row.amountCents), link: deps.cardUrl },
              deps.siteUrl,
            );
          });
        }
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

/** Counts the unknown outcome and records it, with the ledger id and whatever the case adds. */
async function recordUnknown(repo: Repository, row: PendingCharge, report: ChargeRunReport, more: AuditEventDetail): Promise<void> {
  report.unknown++;
  await recordOutcomeUnknown(repo, CHARGE_RUN_ACTOR, row.memberId, row.ledgerId, more);
}

/** The run's try-and-log send, under its own log source. */
const sendMemberEmail = (
  deps: ChargeRunDeps,
  memberId: string,
  render: (member: Member) => Promise<{ subject: string; text: string } | null>,
): Promise<void> => sendEmailTo(deps, "charge run", memberId, render);

/**
 * The email for a row this run flipped to paid: the signup confirmation for a stranded signup, the member never having
 * had one, and the receipt for any other.
 */
function sendEmail(deps: ChargeRunDeps, productId: string, row: PendingCharge, stranded: boolean, paidAt: Date): Promise<void> {
  const { repo, email, siteUrl, accountUrl } = deps;
  return sendMemberEmail(deps, row.memberId, async (member) => {
    if (stranded) {
      const confirmation = await repo.findSignupConfirmation(row.memberId, productId);
      if (confirmation) await deliverSignupConfirmation(email, member, confirmation, accountUrl, siteUrl);
      return null;
    }
    return renderReceipt(repo, productId, row, paidAt, member, siteUrl);
  });
}

/** The receipt for a week a week credit paid, to its member: a failed send is logged and undoes nothing, as the receipt's. */
function sendWeekCreditReceipt(deps: ChargeRunDeps, productId: string, pickupDate: string, memberId: string): Promise<void> {
  return sendMemberEmail(deps, memberId, async (member) => {
    const week = await weekNamed(deps.repo, productId, pickupDate, member.language);
    return renderEmail("weekCreditReceipt", member.language, { week }, deps.siteUrl);
  });
}

/** Issue 196: the notice for a week locked by a declined card, to its member, linking to Update your card: no meal is coming. A failed send is logged and undoes nothing. */
function sendLockedNotice(deps: ChargeRunDeps, productId: string, pickupDate: string, memberId: string): Promise<void> {
  return sendMemberEmail(deps, memberId, async (member) => {
    const week = await weekNamed(deps.repo, productId, pickupDate, member.language);
    return renderEmail("cardLocked", member.language, { week, link: deps.cardUrl }, deps.siteUrl);
  });
}
