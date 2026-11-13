// Issue 155: the rules of a member's Upcoming weeks and History, as rows the two pages draw. 2.5 and 2.6 extend them.
import { cutoffDate, type AdminWeek } from "./pickup-week.js";
import type { MemberWeeks } from "./ports/repository.js";
import type { ProductWithOptions } from "./products.js";

/**
 * One Upcoming week: its marker, whether it closed after it was paid, for a Coming week the date of the cutoff it
 * is charged at (`cutoffDate`), null otherwise, and the button it offers (issue 137): Skip, Unskip, or none, which
 * is always so once the week's cutoff has passed. The page draws its button from `action` and the server checks
 * a request against it.
 */
export type UpcomingRow = {
  week: AdminWeek;
  marker: "paid" | "coming" | "closed" | "weekCredit" | "skipped";
  closedPaid: boolean;
  /** Issue 150: true for a paid row a week credit paid, false otherwise. */
  weekCreditUsed: boolean;
  chargeDate: string | null;
  action: "skip" | "unskip" | null;
};

/** One History week: its marker, the amount charged (0 for a closed week with no charge), and its line. */
export type HistoryRow = {
  week: AdminWeek;
  marker: "paid" | "noMeal" | "skipped" | "weekCredit";
  amountCents: number | null;
  line: "signup" | "paid" | "closed" | "closedPaid" | "skipped" | "weekCredit";
};

/**
 * The Upcoming rows for the listed weeks, with each unspent week credit on the later week it lands on: the first
 * listed week after the one it was granted for that is open, has no paid row, is not skipped and carries no week
 * credit yet (a skipped week does not use one, DEC-032). Week credits land in date order, one to a week; one with
 * no such week shows on none. For a `cancelled` subscription (issue 139) only the weeks still to be made stay: the
 * rows whose marker is `paid`, each with no button. Nothing more is charged, so a Coming, Skipped or Week credit week
 * is left out, and so is a week closed after it was paid, which holds a week credit and is no pickup.
 */
export function upcomingRows(weeks: AdminWeek[], member: MemberWeeks, product: ProductWithOptions, cancelled = false): UpcomingRow[] {
  const paid = new Set(member.paid.map((row) => row.weekOf));
  const creditPaid = new Set(member.paid.filter((row) => row.weekCredit).map((row) => row.weekOf));
  if (cancelled) {
    return weeks
      .filter((week) => week.closedAt === null && paid.has(week.weekOf))
      .map((week) => {
        const used = creditPaid.has(week.weekOf);
        return { week, marker: used ? "weekCredit" : "paid", closedPaid: false, weekCreditUsed: used, chargeDate: null, action: null };
      });
  }
  const skipped = new Set(member.skipped);
  const landed = new Set<string>();
  const grantedFor = member.weekCredits.map((credit) => credit.grantedForWeek).sort();
  for (const granted of grantedFor) {
    const lands = weeks.find(
      (week) => week.weekOf > granted && week.closedAt === null && !paid.has(week.weekOf) && !skipped.has(week.weekOf) && !landed.has(week.weekOf),
    );
    if (lands) landed.add(lands.weekOf);
  }

  return weeks.map((week) => {
    const weekPaid = paid.has(week.weekOf);
    const used = creditPaid.has(week.weekOf);
    if (week.closedAt !== null) return { week, marker: "closed", closedPaid: weekPaid, weekCreditUsed: used, chargeDate: null, action: null };
    if (weekPaid) return { week, marker: used ? "weekCredit" : "paid", closedPaid: false, weekCreditUsed: used, chargeDate: null, action: null };
    if (skipped.has(week.weekOf)) return { week, marker: "skipped", closedPaid: false, weekCreditUsed: false, chargeDate: null, action: week.cutoffPassed ? null : "unskip" };
    const action = week.cutoffPassed ? null : "skip";
    if (landed.has(week.weekOf)) return { week, marker: "weekCredit", closedPaid: false, weekCreditUsed: false, chargeDate: null, action };
    return { week, marker: "coming", closedPaid: false, weekCreditUsed: false, chargeDate: cutoffDate(product, week.weekOf), action };
  });
}

/**
 * The member's last pickup (issue 139), the latest row whose marker is `paid`, or (issue 150) `weekCredit` for a week a
 * week credit paid: an Upcoming row only when `weekCreditUsed`, a ledger row exists; still to come (`passed` false) when it
 * is an Upcoming row, passed when it is a History row; null when neither list has one. A week closed after it was paid
 * holds a week credit and is no pickup, in either list.
 */
export function lastPickup(rows: UpcomingRow[], history: HistoryRow[]): { week: AdminWeek; passed: boolean } | null {
  const upcoming = rows.filter((row) => row.marker === "paid" || (row.marker === "weekCredit" && row.weekCreditUsed)).at(-1);
  if (upcoming) return { week: upcoming.week, passed: false };
  const past = history.filter((row) => row.marker === "paid" || row.marker === "weekCredit").reduce<HistoryRow | null>((latest, row) => (latest === null || row.week.weekOf > latest.week.weekOf ? row : latest), null);
  return past && { week: past.week, passed: true };
}

/**
 * The History rows for the past weeks, in the order given: a week with a paid or skipped ledger row, or closed; the rest are
 * left out. `firstWeek` is the signup's.
 */
export function historyRows(weeks: AdminWeek[], member: MemberWeeks, firstWeek: string): HistoryRow[] {
  const paid = new Map(member.paid.map((row) => [row.weekOf, row.amountCents]));
  const creditPaid = new Set(member.paid.filter((row) => row.weekCredit).map((row) => row.weekOf));
  const skipped = new Set(member.skipped);
  const rows: HistoryRow[] = [];
  for (const week of weeks) {
    const amount = paid.get(week.weekOf);
    if (week.closedAt !== null) {
      rows.push({ week, marker: "noMeal", amountCents: amount ?? 0, line: amount === undefined ? "closed" : "closedPaid" });
    } else if (amount !== undefined) {
      if (creditPaid.has(week.weekOf)) rows.push({ week, marker: "weekCredit", amountCents: amount, line: "weekCredit" });
      else rows.push({ week, marker: "paid", amountCents: amount, line: week.weekOf === firstWeek ? "signup" : "paid" });
    } else if (skipped.has(week.weekOf)) {
      rows.push({ week, marker: "skipped", amountCents: 0, line: "skipped" });
    }
  }
  return rows;
}
