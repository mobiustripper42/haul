// Issue 138: the rules of a member's switch of size or menu, shared by the Upcoming weeks page and `switchMeal`.
import type { UpcomingRow } from "./account-weeks.js";
import type { ProductWithOptions } from "./products.js";

/**
 * The subscription's switch week, its Sunday key: the first row whose cutoff has not passed and whose marker is
 * `coming`, `skipped`, or `closed` with no paid row. Null when no listed week is one.
 */
export function switchWeek(rows: UpcomingRow[]): string | null {
  const row = rows.find(
    (candidate) =>
      !candidate.week.cutoffPassed &&
      (candidate.marker === "coming" || candidate.marker === "skipped" || (candidate.marker === "closed" && !candidate.closedPaid)),
  );
  return row?.week.weekOf ?? null;
}

/**
 * Each option type's choice (option type id → option id) from a switch form, keyed by the type ids as the form's
 * field names. Null for an option that is not the type's, a missing type, or two values for one type. Fields that
 * name no option type are ignored.
 */
export function strictChoices(product: ProductWithOptions, form: FormData): Record<string, string> | null {
  const choices: Record<string, string> = {};
  for (const type of product.optionTypes) {
    const values = form.getAll(type.id);
    const [value] = values;
    if (values.length !== 1 || typeof value !== "string") return null;
    const option = type.options.find((candidate) => candidate.id === value);
    if (!option) return null;
    choices[type.id] = option.id;
  }
  return choices;
}
