// Issue 140: the menu library's rules, one home for the actions, the pages and the client lists.
import { SEPARATOR } from "./member-list.js";
import type { AdminWeek } from "./pickup-week.js";
import type { ProductOption, ProductWithOptions } from "./products.js";

/** A menu: its name and a text for each menu option, keyed by option id. */
export type Menu = { id: string; name: string; texts: Record<string, string>; updatedAt: Date };

export type MenuInput = { name: string; texts: Record<string, string> };

export type MenuErrors = { name?: "required" | "tooLong"; texts: Record<string, "required" | "tooLong"> };

/** The longest name and the longest text, in characters. */
export const MENU_LIMITS = { name: 100, text: 4000 };

/** The options of the product's option type marked `menuTexts`, in position order; `[]` when none is marked. */
export function menuOptions(product: ProductWithOptions): ProductOption[] {
  const type = product.optionTypes.find((candidate) => candidate.menuTexts === true);
  return type ? [...type.options].sort((a, b) => a.position - b.position) : [];
}

/** A text as saved: CRLF to LF, the start and end of the whole text trimmed. */
export function menuText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trim();
}

/** Checks the menu as it would be saved: the name trimmed, each text after `menuText`, counted with `.length`. */
export function checkMenu(input: MenuInput, options: ProductOption[]): MenuErrors {
  const errors: MenuErrors = { texts: {} };
  const name = input.name.trim();
  if (name === "") errors.name = "required";
  else if (name.length > MENU_LIMITS.name) errors.name = "tooLong";
  for (const option of options) {
    const text = menuText(input.texts[option.id] ?? "");
    if (text === "") errors.texts[option.id] = "required";
    else if (text.length > MENU_LIMITS.text) errors.texts[option.id] = "tooLong";
  }
  return errors;
}

/** Of the weeks given, those that hold this menu and are not closed, in the order given. */
export function assignedWeeks(menuId: string, weeks: AdminWeek[], menus: Map<string, string>): AdminWeek[] {
  return weeks.filter((week) => week.closedAt === null && menus.get(week.weekOf) === menuId);
}

/** The menus whose name or any text contains the query, ignoring case, in the order given; an empty query lists all. */
export function filterMenus(menus: Menu[], query: string): Menu[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return menus;
  return menus.filter((menu) => [menu.name, ...Object.values(menu.texts)].some((text) => text.toLowerCase().includes(wanted)));
}

/** The text's non-blank lines, each trimmed, in order: the one home for splitting a menu text (issue 141). */
export function menuLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The menu as the email and the page draw it (issue 141): one section per menu option, in position order, its name and its text's lines. */
export function menuSections(product: ProductWithOptions, menu: Menu): { name: string; lines: string[] }[] {
  return menuOptions(product).map((option) => ({ name: option.name, lines: menuLines(menu.texts[option.id] ?? "") }));
}

/** The text's non-blank lines, each trimmed, joined with `SEPARATOR`. */
export function menuLine(text: string): string {
  return menuLines(text).join(SEPARATOR);
}
