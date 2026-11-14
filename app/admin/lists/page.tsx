import { pluralKey } from "@core/i18n.js";
import { listedWeekTitle } from "@core/pickup-week.js";
import { pickList, weekSummary } from "@core/week-lists.js";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { ButtonRow } from "../../../components/ui/button-row";
import { Card } from "../../../components/ui/card";
import { DataTable } from "../../../components/ui/data-table";
import { Field } from "../../../components/ui/field";
import { Heading } from "../../../components/ui/heading";
import { Hint } from "../../../components/ui/hint";
import { Select } from "../../../components/ui/select";
import { Shell } from "../../../components/ui/shell";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { ADMIN_LISTS_PATH, WEEK_PARAM, adminPickListCsvPath, adminPickupPrintPath, adminSkipsCsvPath } from "../../paths";
import { getRepository } from "../../services";
import { requireAdmin } from "../../session";
import { SiteHeader } from "../../site-header";
import { AdminNav } from "../admin-nav";
import { loadWeekLists } from "./week";

export const generateMetadata = titled("admin.lists.title");

type Query = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * Weekly lists (issue 142): the chosen week's pick list as a table of meals per combination with a total, a line counting
 * skips, week credits and active members, and the three actions: the two downloads and the printable pickup list. The
 * week is chosen with a GET form, so the screen runs no client script.
 */
export default async function AdminLists({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();
  const [t, language, query] = await Promise.all([getTranslator(), getLanguage(), searchParams]);
  const repo = getRepository();
  const { product, weeks, week, cutoffPassed } = await loadWeekLists(repo, new Date(), one(query[WEEK_PARAM]));
  const [lists, subscribers] = await Promise.all([repo.listWeekBoxes(product.id, week.weekOf, week.cutoff), repo.listSubscribers(product.id)]);
  const list = pickList(product, lists.boxes);
  const { skipped, weekCredit } = weekSummary(lists);
  const active = subscribers.filter((subscriber) => subscriber.status === "active").length;
  const credits = weekCredit.length;
  const summary = t("admin.lists.summary", {
    skipped: t(pluralKey(language, "admin.lists.skipped", skipped.length), { n: skipped.length }),
    credits: t(pluralKey(language, "admin.lists.credits", credits), { n: credits }),
    active: t(pluralKey(language, "admin.lists.active", active), { n: active }),
  });

  return (
    <>
      {await SiteHeader({ account: "none", current: "admin" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          {await AdminNav({ current: "lists" })}
          <div className="flex flex-col gap-1">
            <Heading>{t("admin.lists.title")}</Heading>
            <Hint>{t("admin.lists.hint")}</Hint>
          </div>
          <form method="get" action={ADMIN_LISTS_PATH} className="flex flex-wrap items-end gap-x-3 gap-y-3">
            <div className="max-w-card flex-1 basis-64">
              <Field label={t("admin.lists.week")} htmlFor="week">
                <Select
                  id="week"
                  name={WEEK_PARAM}
                  defaultValue={week.weekOf}
                  options={weeks.map((listed) => {
                    const title = listedWeekTitle(t, listed, language);
                    return { value: listed.weekOf, label: listed.cutoffPassed ? t("admin.lists.weekPassed", { title }) : title };
                  })}
                />
              </Field>
            </div>
            <Button kind="secondary" type="submit">
              {t("admin.lists.show")}
            </Button>
          </form>
          <Card width="fill">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Heading level={2}>{t("admin.lists.heading", { days: listedWeekTitle(t, week, language) })}</Heading>
              {cutoffPassed && <Badge kind="success">{t("admin.lists.final")}</Badge>}
            </div>
            <DataTable
              always
              columns={[
                ...product.optionTypes.map((type) => ({ id: type.id, label: type.name })),
                { id: "meals", label: t("admin.lists.meals"), numeric: true },
              ]}
              rows={list.rows.map((row) => ({ id: row.options.join("|"), cells: [...row.options, row.boxes] }))}
              footer={[t("admin.lists.mealsToMake"), ...product.optionTypes.slice(1).map(() => ""), list.total]}
            />
            <Hint>{summary}</Hint>
            <ButtonRow>
              <Button kind="secondary" href={adminPickListCsvPath(week.weekOf)}>
                {t("admin.lists.downloadPickList")}
              </Button>
              <Button kind="secondary" href={adminSkipsCsvPath(week.weekOf)}>
                {t("admin.lists.downloadSkips")}
              </Button>
              <Button kind="secondary" href={adminPickupPrintPath(week.weekOf)}>
                {t("admin.lists.print")}
              </Button>
            </ButtonRow>
          </Card>
          <Hint>{t("admin.lists.spreadsheetHint")}</Hint>
        </div>
      </Shell>
    </>
  );
}
