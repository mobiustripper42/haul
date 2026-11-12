import { menuOptions } from "@core/menus.js";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Hint } from "../../../components/ui/hint";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { ADMIN_MENU_NEW_PATH } from "../../paths";
import { getRepository } from "../../services";
import { requireAdmin } from "../../session";
import { SiteHeader } from "../../site-header";
import { AdminNav } from "../admin-nav";
import { loadCalendar } from "../weeks/calendar";
import { assignedLine } from "./assigned";
import { MenusList } from "./menus-list";
import { MENU_SAVED_PARAM } from "./shared";

export const generateMetadata = titled("admin.menus.title");

type Query = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * The menu library: every menu, most recently saved first, with search in the browser, New menu, and on each row Edit and
 * Duplicate (issue 140). A save lands here with `?saved=<menu id>`, which says "Saved {name}." for a menu that is there.
 */
export default async function AdminMenus({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();
  const [t, language, query] = await Promise.all([getTranslator(), getLanguage(), searchParams]);
  const repo = getRepository();
  const [calendar, menus] = await Promise.all([loadCalendar(repo, new Date()), repo.listMenus()]);
  const saved = menus.find((menu) => menu.id === one(query[MENU_SAVED_PARAM]));

  return (
    <>
      {await SiteHeader({ account: "none", current: "admin" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          {await AdminNav({ current: "menus" })}
          <div className="flex flex-col gap-1">
            <Heading>{t("admin.menus.title")}</Heading>
            <Hint>{t("admin.menus.hint")}</Hint>
          </div>
          <div className="flex">
            <Button kind="primary" href={ADMIN_MENU_NEW_PATH}>
              {t("admin.menus.new")}
            </Button>
          </div>
          {saved && <Notice icon="check">{t("admin.menus.saved", { name: saved.name })}</Notice>}
          <Card width="fill">
            {menus.length === 0 ? (
              <>
                <Heading level={2}>{t("admin.menus.emptyTitle")}</Heading>
                <Hint>{t("admin.menus.emptyBody")}</Hint>
              </>
            ) : (
              <MenusList
                menus={menus}
                firstOption={menuOptions(calendar.product)[0]?.id ?? null}
                assigned={Object.fromEntries(menus.map((menu) => [menu.id, assignedLine(menu.id, calendar, t, language)]))}
                text={{
                  search: t("admin.menus.search"),
                  searchPlaceholder: t("admin.menus.searchPlaceholder"),
                  noMatch: t("admin.menus.noMatch", { q: "{q}" }),
                  edit: t("admin.menus.edit"),
                  duplicate: t("admin.menus.duplicate"),
                }}
              />
            )}
          </Card>
        </div>
      </Shell>
    </>
  );
}
