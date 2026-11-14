import { pluralKey } from "@core/i18n.js";
import { SEPARATOR } from "@core/member-list.js";
import { clevelandDate, formatPickupDate, listedWeekTitle } from "@core/pickup-week.js";
import { pickupRows, weekSummary } from "@core/week-lists.js";
import { PrintSheet } from "../../../../components/ui/print-sheet";
import { getLanguage, getTranslator } from "../../../language";
import { titled } from "../../../page-title";
import { WEEK_PARAM, adminListsPath } from "../../../paths";
import { getRepository } from "../../../services";
import { requireAdmin } from "../../../session";
import { loadWeekLists } from "../week";

export const generateMetadata = titled("admin.lists.print");

type Query = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * The chosen week's pickup list for paper (issue 142): a page with no site header and no admin nav, its meals in name
 * order with a check box and a notes column, and a closing line naming the skips and the week credits.
 */
export default async function AdminPickupPrint({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();
  const [t, language, query] = await Promise.all([getTranslator(), getLanguage(), searchParams]);
  const repo = getRepository();
  const now = new Date();
  const { product, week, cutoffPassed } = await loadWeekLists(repo, now, one(query[WEEK_PARAM]));
  const lists = await repo.listWeekBoxes(product.id, week.weekOf, week.cutoff);
  const rows = pickupRows(lists.boxes);
  const { skipped, weekCredit } = weekSummary(lists);
  const meta = t(pluralKey(language, "admin.print.meta", rows.length), { n: rows.length, date: formatPickupDate(clevelandDate(now), language) });
  const closing = [
    skipped.length > 0 && t("admin.print.skipped", { names: skipped.join(SEPARATOR) }),
    weekCredit.length > 0 && t("admin.print.weekCredit", { names: weekCredit.join(SEPARATOR) }),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <PrintSheet
      wordmark={t("brand.name")}
      heading={t("admin.print.heading", { days: listedWeekTitle(t, week, language) })}
      meta={cutoffPassed ? meta : t("admin.print.notFinal", { meta })}
      columns={[t("admin.print.pickedUp"), t("admin.print.name"), t("admin.print.meal"), t("admin.print.notes")]}
      rows={rows.map((row, at) => ({ id: String(at), cells: [row.name, row.box, row.note === "cardDeclined" ? t("admin.members.cardDeclined") : ""] }))}
      closing={closing === "" ? undefined : closing}
      back={{ href: adminListsPath(week.weekOf), label: t("admin.print.back") }}
    />
  );
}
