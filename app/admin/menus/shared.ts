// Issue 140: the menu form's state, field names and the saved notice's parameter, one home for the actions, the
// form and the list. Not a "use server" file.
import type { MenuErrors } from "@core/menus.js";

/** What was typed, `texts` keyed by option id, and the errors of the last save; `errors` null before a save. */
export type MenuFormState = { name: string; texts: Record<string, string>; errors: MenuErrors | null };

export const MENU_NAME_FIELD = "name";

/** `text:<option id>`. */
export const menuTextField = (optionId: string): string => `text:${optionId}`;

/** The query parameter a save sends the list, holding the saved menu's id. */
export const MENU_SAVED_PARAM = "saved";

/** The query parameter Duplicate's link sends New menu, holding the id of the menu to copy. */
export const MENU_FROM_PARAM = "from";
