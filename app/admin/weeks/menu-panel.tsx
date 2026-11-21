import type { Language, Translator } from "@core/i18n.js";
import { collator } from "@core/member-list.js";
import type { Menu } from "@core/menus.js";
import { listedWeekTitle, type AdminWeek } from "@core/pickup-week.js";
import { Button } from "../../../components/ui/button";
import { Field } from "../../../components/ui/field";
import { Heading } from "../../../components/ui/heading";
import { Hint } from "../../../components/ui/hint";
import { Select } from "../../../components/ui/select";
import { ADMIN_MENU_NEW_PATH, ADMIN_WEEKS_PATH } from "../../paths";
import { assignMenu } from "./actions";

/**
 * An open week's menu, in its row: the library's menus in name order and No menu first with `current` (the menu id the
 * week holds, or null) chosen, or when there are none a way to make one. Either way it ends in a Cancel back to the calendar.
 */
export function MenuPanel({ week, t, language, menus, current }: { week: AdminWeek; t: Translator; language: Language; menus: Menu[]; current: string | null }) {
  const id = `menu-${week.weekOf}`;
  const named = [...menus].sort((a, b) => collator.compare(a.name, b.name));
  const empty = named.length === 0;
  return (
    <form action={assignMenu} className="flex basis-full flex-col gap-4 rounded-md border border-divider bg-surface-alt p-4">
      <input type="hidden" name="week" value={week.weekOf} />
      <Heading level={2}>{t("admin.weeks.menuHeading", { days: listedWeekTitle(t, week, language) })}</Heading>
      {empty ? (
        <Hint>{t("admin.weeks.noMenusYet")}</Hint>
      ) : (
        <div className="max-w-card">
          <Field label={t("admin.weeks.menuLabel")} htmlFor={id}>
            <Select
              id={id}
              name="menu"
              defaultValue={current ?? ""}
              options={[{ value: "", label: t("admin.weeks.noMenu") }, ...named.map((menu) => ({ value: menu.id, label: menu.name }))]}
            />
          </Field>
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {empty ? (
          <Button kind="secondary" href={ADMIN_MENU_NEW_PATH}>
            {t("admin.weeks.newMenu")}
          </Button>
        ) : (
          <Button kind="primary" type="submit">
            {t("admin.weeks.saveMenu")}
          </Button>
        )}
        <Button kind="quiet" href={ADMIN_WEEKS_PATH}>
          {t("admin.weeks.cancel")}
        </Button>
      </div>
    </form>
  );
}
