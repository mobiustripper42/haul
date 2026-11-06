import { compareNames } from "./member-list.js";
import type { Subscriber } from "./ports/repository.js";

/** A phone number as typed: digits, spaces and `+ - ( ) .` only. The Phone column's one exception to the formula rule. */
const PHONE_AS_TYPED = /^[\d\s+\-().]+$/;

/** A cell a spreadsheet would run as a formula starts with one of these. */
const FORMULA_START = /^[=+\-@]/;

/** `value` as one CSV cell: a formula start is neutralised with a leading apostrophe, then RFC 4180 quoting. */
function cell(value: string, { asTyped = false }: { asTyped?: boolean } = {}): string {
  const safe = !asTyped && FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The spreadsheet: Last name, First name, Email, Phone, one column per option type in the order given, Joined;
 * the rows in name order whatever order they arrive in. Every cell is neutralised against formulas except a
 * phone made only of digits, spaces and `+ - ( ) .`.
 */
export function subscribersCsv(optionTypeNames: string[], subscribers: Subscriber[]): string {
  const header = ["Last name", "First name", "Email", "Phone", ...optionTypeNames, "Joined"].map((name) => cell(name));
  const rows = [...subscribers].sort(compareNames).map((subscriber) => [
    cell(subscriber.lastName ?? ""),
    cell(subscriber.firstName ?? ""),
    cell(subscriber.email),
    cell(subscriber.phone ?? "", { asTyped: PHONE_AS_TYPED.test(subscriber.phone ?? "") }),
    ...optionTypeNames.map((typeName) => cell(subscriber.options.find((option) => option.typeName === typeName)?.optionName ?? "")),
    cell(subscriber.joinedDate),
  ]);
  return [header, ...rows].map((record) => `${record.join(",")}\r\n`).join("");
}
