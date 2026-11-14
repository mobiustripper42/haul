import { historyRows, lastPickup, upcomingRows, type HistoryRow, type UpcomingRow } from "@core/account-weeks.js";
import { pastWeeks, upcomingWeeks, type ChangedWeek } from "@core/pickup-week.js";
import type { MemberWeeks } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { getRepository } from "../../services";
import type { Subscribed } from "../subscriber";

/**
 * The member's Upcoming rows at `now` (issue 137): the one home the Upcoming weeks page and its Skip and Unskip
 * actions load them through, so they cannot disagree about which weeks exist or which button each has. A cancelled
 * subscription (issue 139) keeps only its paid weeks, with no button.
 */
export async function loadUpcomingRows({ product, confirmation }: Subscribed, now: Date): Promise<UpcomingRow[]> {
  const repo = getRepository();
  const [changed, ledger] = await Promise.all([repo.listChangedWeeks(product.id, product.firstPickupDate), repo.listMemberWeeks(confirmation.subscriptionId)]);
  return upcomingRows(upcomingWeeks(product, now, changed, confirmation.pickupDate), ledger, product, confirmation.status === "cancelled");
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
  const repo = getRepository();
  const [changed, ledger] = await Promise.all([repo.listChangedWeeks(product.id, product.firstPickupDate), repo.listMemberWeeks(subscriptionId)]);
  return { rows: historyOf(product, now, changed, ledger, firstWeek), ledger };
}

/**
 * The subscription's last pickup at `now` (issue 139), the one load account home, `/account/cancel` and the admin
 * confirm share. Paid rows sit on or after the subscription's first week, so the load needs no first week: it reads
 * Upcoming weeks and History from the product's calendar.
 */
export async function loadLastPickup(product: ProductWithOptions, subscriptionId: string, now: Date): Promise<ReturnType<typeof lastPickup>> {
  const repo = getRepository();
  const [changed, ledger] = await Promise.all([repo.listChangedWeeks(product.id, product.firstPickupDate), repo.listMemberWeeks(subscriptionId)]);
  const upcoming = upcomingRows(upcomingWeeks(product, now, changed), ledger, product);
  return lastPickup(upcoming, historyOf(product, now, changed, ledger, product.firstPickupDate));
}
