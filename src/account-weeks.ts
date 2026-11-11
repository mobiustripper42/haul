// Issue 155: the rules of a member's Upcoming weeks and History, as rows the two pages draw. 2.5 and 2.6 extend them.
import { cutoffDate, type AdminWeek } from "./pickup-week.js";
import type { MemberWeeks } from "./ports/repository.js";
import type { ProductWithOptions } from "./products.js";

/**
 * One Upcoming week: its marker, whether it closed after it was paid, and for a Coming week the date of the
 * cutoff it is charged at (`cutoffDate`), null otherwise.
 */
export type UpcomingRow = {
  week: AdminWeek;
  marker: "paid" | "coming" | "closed" | "weekCredit";
  closedPaid: boolean;
  chargeDate: string | null;
};

/** One History week: its marker, the amount charged (0 for a closed week with no charge), and its line. */
export type HistoryRow = {
  week: AdminWeek;
  marker: "paid" | "noMeal";
  amountCents: number | null;
  line: "signup" | "paid" | "closed" | "closedPaid";
};

/**
 * The Upcoming rows for the listed weeks, with each unspent week credit on the later week it lands on: the first
 * listed week after the one it was granted for that is open, has no paid row and carries no week credit yet.
 * Week credits land in date order, one to a week; one with no such week shows on none.
 */
export function upcomingRows(weeks: AdminWeek[], member: MemberWeeks, product: ProductWithOptions): UpcomingRow[] {
  const paid = new Set(member.paid.map((row) => row.weekOf));
  const landed = new Set<string>();
  const grantedFor = member.weekCredits.map((credit) => credit.grantedForWeek).sort();
  for (const granted of grantedFor) {
    const lands = weeks.find((week) => week.weekOf > granted && week.closedAt === null && !paid.has(week.weekOf) && !landed.has(week.weekOf));
    if (lands) landed.add(lands.weekOf);
  }

  return weeks.map((week) => {
    const weekPaid = paid.has(week.weekOf);
    if (week.closedAt !== null) return { week, marker: "closed", closedPaid: weekPaid, chargeDate: null };
    if (weekPaid) return { week, marker: "paid", closedPaid: false, chargeDate: null };
    if (landed.has(week.weekOf)) return { week, marker: "weekCredit", closedPaid: false, chargeDate: null };
    return { week, marker: "coming", closedPaid: false, chargeDate: cutoffDate(product, week.weekOf) };
  });
}

/**
 * The History rows for the past weeks, in the order given: a week with a paid ledger row or closed; the rest are
 * left out. `firstWeek` is the signup's.
 */
export function historyRows(weeks: AdminWeek[], member: MemberWeeks, firstWeek: string): HistoryRow[] {
  const paid = new Map(member.paid.map((row) => [row.weekOf, row.amountCents]));
  const rows: HistoryRow[] = [];
  for (const week of weeks) {
    const amount = paid.get(week.weekOf);
    if (week.closedAt !== null) {
      rows.push({ week, marker: "noMeal", amountCents: amount ?? 0, line: amount === undefined ? "closed" : "closedPaid" });
    } else if (amount !== undefined) {
      rows.push({ week, marker: "paid", amountCents: amount, line: week.weekOf === firstWeek ? "signup" : "paid" });
    }
  }
  return rows;
}
