import { upcomingRows, type UpcomingRow } from "@core/account-weeks.js";
import { upcomingWeeks } from "@core/pickup-week.js";
import { getRepository } from "../../services";
import type { Subscribed } from "../subscriber";

/**
 * The member's Upcoming rows at `now` (issue 137): the one home the Upcoming weeks page and its Skip and Unskip
 * actions load them through, so they cannot disagree about which weeks exist or which button each has.
 */
export async function loadUpcomingRows({ product, confirmation }: Subscribed, now: Date): Promise<UpcomingRow[]> {
  const repo = getRepository();
  const [changed, ledger] = await Promise.all([repo.listChangedWeeks(product.id, product.firstPickupDate), repo.listMemberWeeks(confirmation.subscriptionId)]);
  return upcomingRows(upcomingWeeks(product, now, changed, confirmation.pickupDate), ledger, product);
}
