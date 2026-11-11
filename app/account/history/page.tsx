import { historyRows, type HistoryRow } from "@core/account-weeks.js";
import { mealLabel } from "@core/member-list.js";
import { formatUsdWhole } from "@core/money.js";
import { listedWeekTitle, pastWeeks } from "@core/pickup-week.js";
import { Badge } from "../../../components/ui/badge";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Hint } from "../../../components/ui/hint";
import { Shell } from "../../../components/ui/shell";
import { WeekList } from "../../../components/ui/week-list";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { getRepository } from "../../services";
import { SiteHeader } from "../../site-header";
import { requireSubscriber } from "../subscriber";
import { MARKER_BADGES } from "../week-markers";

export const generateMetadata = titled("account.history.title");

/** The key of a History row's one status line. */
const LINES = {
  signup: "account.history.signup",
  paid: "account.marker.paid",
  closed: "account.marker.closed",
  closedPaid: "account.history.closedPaid",
} as const satisfies Record<HistoryRow["line"], string>;

/**
 * A member's History (issue 155): their past weeks, newest first, from the ledger. Read only. With no past week
 * it is the heading and the intro line alone.
 */
export default async function History() {
  const { product, confirmation } = await requireSubscriber();
  const repo = getRepository();
  const [t, language, changed, ledger] = await Promise.all([
    getTranslator(),
    getLanguage(),
    repo.listChangedWeeks(product.id, product.firstPickupDate),
    repo.listMemberWeeks(confirmation.subscriptionId),
  ]);
  const weeks = pastWeeks(product, new Date(), changed, confirmation.pickupDate);
  const paidWeeks = new Set(ledger.paid.map((row) => row.weekOf));
  const meal = mealLabel(confirmation.options);
  const rows = historyRows(weeks, ledger, confirmation.pickupDate).map((row) => ({
    id: row.week.weekOf,
    title: listedWeekTitle(t, row.week, language),
    lines: [...(paidWeeks.has(row.week.weekOf) ? [meal] : []), t(LINES[row.line])],
    amount: formatUsdWhole(row.amountCents ?? 0),
    badge: <Badge kind={MARKER_BADGES[row.marker].kind}>{t(MARKER_BADGES[row.marker].key)}</Badge>,
  }));

  return (
    <>
      {await SiteHeader({ account: "none", current: "history" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          <Heading>{t("account.history.title")}</Heading>
          <Hint>{t("account.history.intro")}</Hint>
          {rows.length > 0 && (
            <Card width="fill">
              <WeekList rows={rows} />
            </Card>
          )}
        </div>
      </Shell>
    </>
  );
}
