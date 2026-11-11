import { upcomingRows, type UpcomingRow } from "@core/account-weeks.js";
import type { Language, Translator } from "@core/i18n.js";
import { formatPickupDate, listedWeekTitle, upcomingWeeks } from "@core/pickup-week.js";
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

export const generateMetadata = titled("account.weeks.title");

/** The one muted line under an Upcoming week's title. */
function lineOf(row: UpcomingRow, t: Translator, language: Language): string {
  if (row.marker === "coming" && row.chargeDate !== null) return t("account.weeks.charged", { date: formatPickupDate(row.chargeDate, language) });
  if (row.marker === "closed") return t(row.closedPaid ? "account.weeks.closedPaid" : "account.weeks.closedNoCharge");
  if (row.marker === "weekCredit") return t("account.weeks.weekCredit");
  return t("account.marker.paid");
}

/**
 * A member's Upcoming weeks (issue 155): 12 weeks from the later of their first week and the calendar's current
 * week, each marked Paid, Closed or Week credit, or coming with no badge. Read only.
 */
export default async function UpcomingWeeks() {
  const { product, confirmation } = await requireSubscriber();
  const repo = getRepository();
  const [t, language, changed, ledger] = await Promise.all([
    getTranslator(),
    getLanguage(),
    repo.listChangedWeeks(product.id, product.firstPickupDate),
    repo.listMemberWeeks(confirmation.subscriptionId),
  ]);
  const weeks = upcomingWeeks(product, new Date(), changed, confirmation.pickupDate);
  const rows = upcomingRows(weeks, ledger, product).map((row) => ({
    id: row.week.weekOf,
    title: listedWeekTitle(t, row.week, language),
    lines: [lineOf(row, t, language)],
    badge: row.marker === "coming" ? undefined : <Badge kind={MARKER_BADGES[row.marker].kind}>{t(MARKER_BADGES[row.marker].key)}</Badge>,
  }));

  return (
    <>
      {await SiteHeader({ account: "none", current: "weeks" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          <Heading>{t("account.weeks.title")}</Heading>
          <Hint>{t("account.weeks.intro")}</Hint>
          <Card width="fill">
            <WeekList rows={rows} />
          </Card>
        </div>
      </Shell>
    </>
  );
}
