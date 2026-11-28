import { digitsOf } from "./phone.js";
import type { Subscriber } from "./ports/repository.js";

export type SortKey = "name" | "meal" | "joined" | "status";
export type SortDirection = "asc" | "desc";
export type Sort = { key: SortKey; direction: SortDirection };

/** The sort keys and their first direction, for the headers and the "Sort by" select: Joined starts newest first. */
export const SORT_CHOICES: readonly Sort[] = [
  { key: "name", direction: "asc" },
  { key: "joined", direction: "desc" },
  { key: "meal", direction: "asc" },
  { key: "status", direction: "asc" },
];

/** How the list opens: the page's first paint and the client's first state. */
export const OPENING_SORT: Sort = { key: "name", direction: "asc" };

/** Case-insensitive, accents kept: "abara" and "Abara" are one name, "Lee" comes before "Lee Kim". */
export const collator = new Intl.Collator("en", { sensitivity: "accent" });

type Named = Pick<Subscriber, "firstName" | "lastName">;

/** Name order: last name then first name, case-insensitive. A null name part compares as an empty string. */
export function compareNames(a: Named, b: Named): number {
  return collator.compare(a.lastName ?? "", b.lastName ?? "") || collator.compare(a.firstName ?? "", b.firstName ?? "");
}

/** "Last, First", printing whichever part exists. */
export function subscriberName({ firstName, lastName }: Named): string {
  return [lastName, firstName].filter(Boolean).join(", ");
}

/** What joins the parts of one line: the picks, and phone · language. */
export const SEPARATOR = " · ";

/** The picked options joined with `SEPARATOR`. */
export function mealLabel(options: Subscriber["options"]): string {
  return options.map((option) => option.optionName).join(SEPARATOR);
}

/** Each status's place in the Status sort, by rank rather than spelling, so a later status lands where it is put. */
const STATUS_ORDER: Record<Subscriber["status"], string> = { active: "0", cancelled: "1" };

/** The Status column sorts on the row's own status, Active before Cancelled (issue 139); ties on it fall to the name. */
const COLUMN: Record<Exclude<SortKey, "name">, (row: Subscriber) => string> = {
  meal: (row) => mealLabel(row.options),
  joined: (row) => row.joinedDate,
  status: (row) => STATUS_ORDER[row.status],
};

/** Issue 263: a person on the list: the subscription their row shows, and their earlier ones, newest first. */
export type MemberRow = { memberId: string; current: Subscriber; earlier: Subscriber[] };

/**
 * One row per member. The current subscription is an active one over a cancelled one, then the newest joined date, then
 * the later one in `rows`' order (`listSubscribers`' first-payment order); `earlier` is the rest, newest first by the
 * same rule. People come in the order their first subscription appears in `rows`.
 */
export function groupByMember(rows: Subscriber[]): MemberRow[] {
  const byMember = new Map<string, { row: Subscriber; place: number }[]>();
  rows.forEach((row, place) => {
    const held = byMember.get(row.memberId);
    if (held) held.push({ row, place });
    else byMember.set(row.memberId, [{ row, place }]);
  });
  return [...byMember].map(([memberId, held]) => {
    const [current, ...earlier] = held
      .sort(
        (a, b) =>
          collator.compare(STATUS_ORDER[a.row.status], STATUS_ORDER[b.row.status]) ||
          collator.compare(b.row.joinedDate, a.row.joinedDate) ||
          b.place - a.place,
      )
      .map(({ row }) => row);
    return { memberId, current: current!, earlier };
  });
}

/**
 * The people matching `query` on their current subscription's name, email or phone, in the order given. A name matches
 * as the first name, the last name, "Last, First" or "First Last". Any digits in the query match the phone's digits,
 * punctuation ignored in both; a query with no digits does not match on phone.
 */
export function filterMembers(rows: MemberRow[], query: string): MemberRow[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return rows;
  const digits = digitsOf(wanted);
  return rows.filter(({ current }) => {
    const parts = [current.firstName, current.lastName].filter((part): part is string => Boolean(part));
    const text = [...parts, subscriberName(current), parts.join(" "), current.email];
    return text.some((candidate) => candidate.toLowerCase().includes(wanted)) || (digits !== "" && digitsOf(current.phone ?? "").includes(digits));
  });
}

/** A new list in `sort`'s order, on each person's current subscription. A tie breaks on name, ascending, even when the column is descending. */
export function sortMembers(rows: MemberRow[], sort: Sort): MemberRow[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === "name") return sign * compareNames(a.current, b.current);
    const column = COLUMN[sort.key];
    return sign * collator.compare(column(a.current), column(b.current)) || compareNames(a.current, b.current);
  });
}

/** What a click on `key`'s header sorts by next: the sorted header reverses; another starts at its first direction. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: SORT_CHOICES.find((choice) => choice.key === key)?.direction ?? "asc" };
}
