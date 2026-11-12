import { notFound } from "next/navigation";
import { menuOptions } from "@core/menus.js";
import { Button } from "../../../../components/ui/button";
import { Heading } from "../../../../components/ui/heading";
import { Shell } from "../../../../components/ui/shell";
import { getLanguage, getTranslator } from "../../../language";
import { titled } from "../../../page-title";
import { ADMIN_MENUS_PATH } from "../../../paths";
import { getRepository } from "../../../services";
import { requireAdmin } from "../../../session";
import { SiteHeader } from "../../../site-header";
import { AdminNav } from "../../admin-nav";
import { loadCalendar } from "../../weeks/calendar";
import { saveMenu } from "../actions";
import { assignedLine } from "../assigned";
import { menuFormText } from "../form-text";
import { MenuForm } from "../menu-form";

export const generateMetadata = titled("admin.menu.editTitle");

/**
 * Edit menu (issue 140): the menu's name and a text for each menu option, and the upcoming weeks it is on. Duplicate is
 * on the list only. An id the library does not hold, or one that is not a UUID, is Next's not-found page.
 */
export default async function EditMenu({ params }: { params: Promise<{ menu: string }> }) {
  await requireAdmin();
  const { menu: id } = await params;
  const repo = getRepository();
  const menu = await repo.findMenu(id);
  if (!menu) notFound();
  const [t, language, calendar] = await Promise.all([getTranslator(), getLanguage(), loadCalendar(repo, new Date())]);

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
          <Heading>{t("admin.menu.editTitle")}</Heading>
          <MenuForm
            action={saveMenu.bind(null, menu.id)}
            state={{ name: menu.name, texts: menu.texts, errors: null }}
            options={menuOptions(calendar.product).map(({ id: optionId, name }) => ({ id: optionId, name }))}
            text={menuFormText(t)}
            assigned={{ line: assignedLine(menu.id, calendar, t, language), help: t("admin.menus.assignHelp") }}
          />
        </div>
      </Shell>
    </>
  );
}
