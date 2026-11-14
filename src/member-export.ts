import { compareNames } from "./member-list.js";
import type { Subscriber } from "./ports/repository.js";

/** A phone number as typed: digits, spaces and `+ - ( ) .` only. The Phone column's one exception to the formula rule. */
const PHONE_AS_TYPED = /^[\d\s+\-().]+$/;

/** A cell a spreadsheet would run as a formula starts with one of these, or with the fullwidth form of one (＝ ＋ － ＠), which some spreadsheets read as the ASCII character. */
const FORMULA_START = /^[=+\-@＝＋－＠]/;

/** `value` as one CSV cell: a formula start is neutralised with a leading apostrophe, then RFC 4180 quoting. */
export function cell(value: string, { asTyped = false }: { asTyped?: boolean } = {}): string {
  const safe = !asTyped && FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The member's columns, as cells in the order of "Last name, First name, Email, Phone", then one per option type in the
 * order given. Neutralised against formulas, except a phone made only of digits, spaces and `+ - ( ) .`.
 */
export function memberCells(
  optionTypeNames: string[],
  member: Pick<Subscriber, "firstName" | "lastName" | "email" | "phone" | "options">,
): string[] {
  return [
    cell(member.lastName ?? ""),
    cell(member.firstName ?? ""),
    cell(member.email),
    cell(member.phone ?? "", { asTyped: PHONE_AS_TYPED.test(member.phone ?? "") }),
    ...optionTypeNames.map((typeName) => cell(member.options.find((option) => option.typeName === typeName)?.optionName ?? "")),
  ];
}

/**
 * The spreadsheet: Last name, First name, Email, Phone, one column per option type in the order given, Joined;
 * the rows in name order whatever order they arrive in. Every cell is neutralised against formulas except a
 * phone made only of digits, spaces and `+ - ( ) .`.
 */
export function subscribersCsv(optionTypeNames: string[], subscribers: Subscriber[]): string {
  const header = ["Last name", "First name", "Email", "Phone", ...optionTypeNames, "Joined"].map((name) => cell(name));
  const rows = [...subscribers].sort(compareNames).map((subscriber) => [...memberCells(optionTypeNames, subscriber), cell(subscriber.joinedDate)]);
  return [header, ...rows].map((record) => `${record.join(",")}\r\n`).join("");
}
