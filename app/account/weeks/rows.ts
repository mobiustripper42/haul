import { historyRows, lastPickup, upcomingRows, type HistoryRow, type UpcomingRow } from "@core/account-weeks.js";
import { nextPickup, pastWeeks, upcomingWeeks, weeksFrom, type AdminWeek, type ChangedWeek } from "@core/pickup-week.js";
import type { MemberWeeks } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { getRepository } from "../../services";
import type { Subscribed } from "../subscriber";

/** The product's changed weeks and the subscription's ledger: the paired read every loader here starts from. */
async function readWeeks(product: ProductWithOptions, subscriptionId: string): Promise<[ChangedWeek[], MemberWeeks]> {
  const repo = getRepository();
  return Promise.all([repo.listChangedWeeks(product.id, product.firstPickupDate), repo.listMemberWeeks(subscriptionId)]);
}

/**
 * The member's Upcoming rows at `now` (issue 137): the one home the Upcoming weeks page and its Skip and Unskip
 * actions load them through, so they cannot disagree about which weeks exist or which button each has. A cancelled
 * subscription (issue 139) keeps only its paid weeks, with no button.
 */
export async function loadUpcomingRows({ product, confirmation }: Subscribed, now: Date): Promise<UpcomingRow[]> {
  const [changed, ledger] = await readWeeks(product, confirmation.subscriptionId);
  return upcomingRows(upcomingWeeks(product, now, changed, confirmation.pickupDate), ledger, product, confirmation.status === "cancelled");
}

/**
 * Issue 202: the member's next week at `now`, walked from the product's weeks with their skips, `declinedWeek` as
 * `lockedOn`; with `cutoffAhead`, the first whose cutoff is still ahead. The one read account home and Update your card share.
 */
export async function loadNextPickup({ product, confirmation }: Subscribed, now: Date, options: { cutoffAhead?: boolean } = {}): Promise<AdminWeek | null> {
  const [changed, ledger] = await readWeeks(product, confirmation.subscriptionId);
  return nextPickup(weeksFrom(product, now, changed), confirmation.pickupDate, confirmation.declinedWeek, { ...options, skipped: ledger.skipped });
}

/** The History rows for the weeks that have passed at `now`, newest first (issue 155): the ledger decides which weeks they list. */
function historyOf(product: ProductWithOptions, now: Date, changed: ChangedWeek[], ledger: MemberWeeks, firstWeek: string): HistoryRow[] {
  return historyRows(pastWeeks(product, now, changed, firstWeek), ledger, firstWeek);
}

/**
 * The member's History rows at `now` (issue 155), and the ledger they were read from, whose paid rows hold the picks each
 * paid week was charged for. `firstWeek` is the signup's.
 */
export async function loadHistoryRows(product: ProductWithOptions, subscriptionId: string, firstWeek: string, now: Date): Promise<{ rows: HistoryRow[]; ledger: MemberWeeks }> {
  const [changed, ledger] = await readWeeks(product, subscriptionId);
  return { rows: historyOf(product, now, changed, ledger, firstWeek), ledger };
}

/**
 * The subscription's last pickup at `now` (issue 139), the one load account home, `/account/cancel` and the admin
 * confirm share. Paid rows sit on or after the subscription's first week, so the load needs no first week: it reads
 * Upcoming weeks and History from the product's calendar.
 */
export async function loadLastPickup(product: ProductWithOptions, subscriptionId: string, now: Date): Promise<ReturnType<typeof lastPickup>> {
  const [changed, ledger] = await readWeeks(product, subscriptionId);
  const upcoming = upcomingRows(upcomingWeeks(product, now, changed), ledger, product);
  return lastPickup(upcoming, historyOf(product, now, changed, ledger, product.firstPickupDate));
}
