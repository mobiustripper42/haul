// Issue 140: the words New menu and Edit menu give `MenuForm`, translated once for both pages.
import type { Translator } from "@core/i18n.js";
import type { MenuFormText } from "./menu-form";

/** `MenuForm`'s words in the request's language; `textLabel`, `textRequired` and `textTooLong` keep their `{option}`. */
export const menuFormText = (t: Translator): MenuFormText => ({
  name: t("admin.menu.name"),
  nameHelp: t("admin.menu.nameHelp"),
  textLabel: t("admin.menu.textLabel", { option: "{option}" }),
  textHelp: t("admin.menu.textHelp"),
  save: t("admin.menu.save"),
  errors: {
    nameRequired: t("admin.menu.nameRequired"),
    nameTooLong: t("admin.menu.nameTooLong"),
    textRequired: t("admin.menu.textRequired", { option: "{option}" }),
    textTooLong: t("admin.menu.textTooLong", { option: "{option}" }),
  },
});
