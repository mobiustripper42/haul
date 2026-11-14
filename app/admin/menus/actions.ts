"use server";

// New menu's and Edit menu's server actions (issue 140). Each calls `requireAdmin` first, checks the form against the
// product's current menu options, and writes under `withActor` so the audit trigger names the admin. A failed check
// returns the state `useActionState` hands the form, with everything as typed and the errors, and writes nothing: two
// menu texts can outgrow a cookie's 4 KB, so the draft is not kept in one.
import { redirect } from "next/navigation";
import { checkMenu, menuOptions, menuText, type MenuErrors, type MenuInput } from "@core/menus.js";
import { requireSupperClub } from "@core/products.js";
import { ADMIN_MENUS_PATH } from "../../paths";
import { getRepository } from "../../services";
import { requireAdmin } from "../../session";
import { MENU_NAME_FIELD, MENU_SAVED_PARAM, menuTextField, type MenuFormState } from "./shared";

/** A form value exactly as posted: neither trimmed nor with its line breaks changed; "" when not posted. */
const posted = (formData: FormData, field: string): string => {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
};

const hasErrors = (errors: MenuErrors): boolean => errors.name !== undefined || Object.keys(errors.texts).length > 0;

/**
 * What the form posted, checked against the product's menu options: the state to hand back when something is at fault,
 * or the input to store, cleaned.
 */
async function readForm(formData: FormData): Promise<{ state: MenuFormState } | { input: MenuInput }> {
  const options = menuOptions(await requireSupperClub(getRepository()));
  const name = posted(formData, MENU_NAME_FIELD);
  const texts = Object.fromEntries(options.map((option) => [option.id, posted(formData, menuTextField(option.id))]));
  const errors = checkMenu({ name, texts }, options);
  if (hasErrors(errors)) return { state: { name, texts, errors } };
  return { input: { name: name.trim(), texts: Object.fromEntries(Object.entries(texts).map(([id, text]) => [id, menuText(text)])) } };
}

/** The list, with the menu just saved named in a notice. */
const savedPath = (id: string): string => `${ADMIN_MENUS_PATH}?${new URLSearchParams({ [MENU_SAVED_PARAM]: id })}`;

/** Makes a menu from the form. */
export async function createMenu(_state: MenuFormState, formData: FormData): Promise<MenuFormState> {
  const admin = await requireAdmin();
  const form = await readForm(formData);
  if ("state" in form) return form.state;
  const menu = await getRepository().withActor({ member: admin.id }, (scoped) => scoped.createMenu(form.input));
  redirect(savedPath(menu.id));
}

/** Replaces the menu `id`'s name and texts. An unknown id goes back to the list with no notice, writing nothing. */
export async function saveMenu(id: string, _state: MenuFormState, formData: FormData): Promise<MenuFormState> {
  const admin = await requireAdmin();
  const form = await readForm(formData);
  if ("state" in form) return form.state;
  const menu = await getRepository().withActor({ member: admin.id }, (scoped) => scoped.saveMenu(id, form.input));
  redirect(menu ? savedPath(menu.id) : ADMIN_MENUS_PATH);
}
