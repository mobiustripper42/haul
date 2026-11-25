import { historyRows, lastPickup, lockedWeek, upcomingRows, type HistoryRow, type UpcomingRow } from "@core/account-weeks.js";
import { memberMenuLines } from "@core/menus.js";
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
 * subscription (issue 139) keeps only its paid weeks, with no button. A locked one (issue 198) passes `lockedWeek`, the
 * one place the lock is read: no button, and the weeks after the declined week read Locked.
 */
export async function loadUpcomingRows({ product, confirmation }: Subscribed, now: Date): Promise<UpcomingRow[]> {
  const [changed, ledger] = await readWeeks(product, confirmation.subscriptionId);
  return upcomingRows(upcomingWeeks(product, now, changed, confirmation.pickupDate), ledger, product, confirmation.status === "cancelled", lockedWeek(confirmation));
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

/** A listed week's menu as its rolldown draws it (issue 243): the menu's name, whether its email has yet to go out, and the member's own dishes. */
export type WeekMenu = { name: string; proposed: boolean; dishes: string[] };

/**
 * The menus of the Upcoming `rows` that have a rolldown (issue 243): an open week with a menu that has dishes for the member's
 * choice, keyed by its week. A paid week shows the picks of its own paid row in `ledger` (which already count a spent week
 * credit); any other, those in effect for the week its row says its meal comes from (`picksWeek`). Two reads, one trip each.
 */
export async function loadWeekMenus({ product, confirmation }: Subscribed, rows: UpcomingRow[], ledger: MemberWeeks): Promise<Map<string, WeekMenu>> {
  const repo = getRepository();
  const open = rows.filter((row) => row.week.closedAt === null);
  const paidPicks = new Map(ledger.paid.map((row) => [row.weekOf, row.options]));
  const unpaid = new Set(open.filter((row) => !paidPicks.has(row.week.weekOf)).map((row) => row.picksWeek));
  const [menus, picked] = await Promise.all([
    repo.findWeekMenus(product.id, open.map((row) => row.week.weekOf)),
    repo.findOptionsForWeeks(confirmation.subscriptionId, [...unpaid]),
  ]);
  const found = new Map<string, WeekMenu>();
  for (const row of open) {
    const assigned = menus.get(row.week.weekOf);
    if (assigned === undefined) continue;
    const dishes = memberMenuLines(product, assigned.menu, paidPicks.get(row.week.weekOf) ?? picked.get(row.picksWeek) ?? []);
    if (dishes.length > 0) found.set(row.week.weekOf, { name: assigned.menu.name, proposed: assigned.sentAt === null, dishes });
  }
  return found;
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
