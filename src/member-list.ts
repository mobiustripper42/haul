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
const collator = new Intl.Collator("en", { sensitivity: "accent" });

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

const digitsOf = (text: string): string => text.replace(/\D/g, "");

/**
 * The rows matching `query` on name, email or phone, in the order given. A name matches as the first name, the
 * last name, "Last, First" or "First Last". Any digits in the query match the phone's digits, punctuation
 * ignored in both; a query with no digits does not match on phone.
 */
export function filterSubscribers(rows: Subscriber[], query: string): Subscriber[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return rows;
  const digits = digitsOf(wanted);
  return rows.filter((row) => {
    const parts = [row.firstName, row.lastName].filter((part): part is string => Boolean(part));
    const text = [...parts, subscriberName(row), parts.join(" "), row.email];
    return text.some((candidate) => candidate.toLowerCase().includes(wanted)) || (digits !== "" && digitsOf(row.phone ?? "").includes(digits));
  });
}

/** In Phase 1 every row is Active; the Status column sorts, and ties on it fall to the name. */
const COLUMN: Record<Exclude<SortKey, "name">, (row: Subscriber) => string> = {
  meal: (row) => mealLabel(row.options),
  joined: (row) => row.joinedDate,
  status: () => "",
};

/** A new list in `sort`'s order. A tie breaks on name, ascending, even when the column is descending. */
export function sortSubscribers(rows: Subscriber[], sort: Sort): Subscriber[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === "name") return sign * compareNames(a, b);
    const column = COLUMN[sort.key];
    return sign * collator.compare(column(a), column(b)) || compareNames(a, b);
  });
}

/** What a click on `key`'s header sorts by next: the sorted header reverses; another starts at its first direction. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: SORT_CHOICES.find((choice) => choice.key === key)?.direction ?? "asc" };
}
