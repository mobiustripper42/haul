// Issue 142: a week's meals and skips as the pick list, its CSV, the skips CSV and the print rows. The one home of the
// week's counts and names: the screen, the two downloads and the print page read these functions and cannot disagree.
import { cell, memberCells } from "./member-export.js";
import { compareNames, mealLabel, subscriberName } from "./member-list.js";
import type { WeekBox, WeekBoxes, WeekMember } from "./ports/repository.js";
import type { ProductWithOptions } from "./products.js";

/** One row per combination of the product's options in position order, zeros included, and the total. */
export type PickList = { rows: { options: string[]; boxes: number }[]; total: number };

/** A row of the printed pickup list: "Last, First", the options joined by " · ", and its note. */
export type PickupRow = { name: string; box: string; note: "cardDeclined" | null };

/** The last row of the pick list's CSV: its first cell. */
const MEALS_TO_MAKE = "Meals to make";

/** A header's or a record's cells as one CRLF-ended CSV record. */
const record = (cells: string[]): string => `${cells.join(",")}\r\n`;

/**
 * The meals counted per combination of option names: one row per combination of the product's options, the first
 * option type outermost and each type's options after it, zeros included. A product's types and options are loaded in
 * position order, so that is the order the rows come in.
 */
export function pickList(product: ProductWithOptions, boxes: WeekBox[]): PickList {
  const combinations = product.optionTypes.reduce<{ typeName: string; optionName: string }[][]>(
    (partial, type) => partial.flatMap((combination) => type.options.map((option) => [...combination, { typeName: type.name, optionName: option.name }])),
    [[]],
  );
  const rows = combinations.map((combination) => ({
    options: combination.map((pick) => pick.optionName),
    boxes: boxes.filter((box) => combination.every((pick) => box.options.some((option) => option.typeName === pick.typeName && option.optionName === pick.optionName))).length,
  }));
  return { rows, total: rows.reduce((sum, row) => sum + row.boxes, 0) };
}

/**
 * The pick list as a spreadsheet: the option types' names and "Meals" as the header, one row per combination, and a last
 * row "Meals to make" in the first column with the total under "Meals". Every cell is neutralised as the member
 * spreadsheet's are.
 */
export function pickListCsv(product: ProductWithOptions, list: PickList): string {
  const types = product.optionTypes;
  const header = [...types.map((type) => type.name), "Meals"].map((name) => cell(name));
  const rows = list.rows.map((row) => [...row.options.map((name) => cell(name)), String(row.boxes)]);
  const last = [cell(MEALS_TO_MAKE), ...types.slice(1).map(() => ""), String(list.total)];
  return [header, ...rows, last].map(record).join("");
}

/** The skips as a spreadsheet: the member columns (`memberCells`), the rows in name order whatever order they arrive in. */
export function skipsCsv(optionTypeNames: string[], skips: WeekMember[]): string {
  const header = ["Last name", "First name", "Email", "Phone", ...optionTypeNames].map((name) => cell(name));
  const rows = [...skips].sort(compareNames).map((skip) => memberCells(optionTypeNames, skip));
  return [header, ...rows].map(record).join("");
}

/** The printed pickup list's rows, one per meal, in name order. */
export function pickupRows(boxes: WeekBox[]): PickupRow[] {
  return [...boxes].sort(compareNames).map((box) => ({ name: subscriberName(box), box: mealLabel(box.options), note: box.cardDeclined ? "cardDeclined" : null }));
}

/**
 * The names of the week's skips and of the meals a week credit paid, each "Last, First" in name order, and the number of
 * the week's members: its meals plus its skips, one per subscription.
 */
export function weekSummary(boxes: WeekBoxes): { skipped: string[]; weekCredit: string[]; members: number } {
  const named = (members: WeekMember[]): string[] => [...members].sort(compareNames).map(subscriberName);
  return { skipped: named(boxes.skips), weekCredit: named(boxes.boxes.filter((box) => box.weekCredit)), members: boxes.boxes.length + boxes.skips.length };
}
