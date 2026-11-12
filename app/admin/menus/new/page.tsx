import { menuOptions } from "@core/menus.js";
import { requireSupperClub } from "@core/products.js";
import { Button } from "../../../../components/ui/button";
import { Heading } from "../../../../components/ui/heading";
import { Shell } from "../../../../components/ui/shell";
import { getTranslator } from "../../../language";
import { titled } from "../../../page-title";
import { ADMIN_MENUS_PATH } from "../../../paths";
import { getRepository } from "../../../services";
import { requireAdmin } from "../../../session";
import { SiteHeader } from "../../../site-header";
import { AdminNav } from "../../admin-nav";
import { createMenu } from "../actions";
import { menuFormText } from "../form-text";
import { MenuForm } from "../menu-form";
import { MENU_FROM_PARAM, type MenuFormState } from "../shared";

export const generateMetadata = titled("admin.menu.newTitle");

type Query = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * New menu (issue 140): an empty form with a field for each menu option. With `?from=<menu id>`, Duplicate's link, it
 * opens holding that menu's name with " (copy)" added, in the admin's language, and every text; nothing is written
 * until Save, which makes a new menu on no week. An unknown or non-UUID id opens it empty.
 */
export default async function NewMenu({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();
  const [t, query] = await Promise.all([getTranslator(), searchParams]);
  const repo = getRepository();
  const options = menuOptions(await requireSupperClub(repo));
  const from = one(query[MENU_FROM_PARAM]);
  const original = from === undefined ? null : await repo.findMenu(from);
  const state: MenuFormState = original
    ? { name: t("admin.menus.copyName", { name: original.name }), texts: original.texts, errors: null }
    : { name: "", texts: {}, errors: null };

  return (
    <>
      {await SiteHeader({ account: "none", current: "admin" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          {await AdminNav({ current: "menus" })}
          <div className="flex">
            <Button kind="quiet" href={ADMIN_MENUS_PATH} back flush>
              {t("admin.menu.back")}
            </Button>
          </div>
          <Heading>{t("admin.menu.newTitle")}</Heading>
          <MenuForm action={createMenu} state={state} options={options.map(({ id, name }) => ({ id, name }))} text={menuFormText(t)} />
        </div>
      </Shell>
    </>
  );
}
