import type { ReactElement } from "react";
import type { UpcomingRow } from "@core/account-weeks.js";
import type { Language, Translator } from "@core/i18n.js";
import { formatPickupDate, listedWeekTitle } from "@core/pickup-week.js";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Hint } from "../../../components/ui/hint";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { WeekList } from "../../../components/ui/week-list";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { ACCOUNT_WEEKS_CUTOFF_ERROR } from "../../paths";
import { SiteHeader } from "../../site-header";
import { requireSubscriber } from "../subscriber";
import { MARKER_BADGES } from "../week-markers";
import { skipWeek, unskipWeek } from "./actions";
import { loadUpcomingRows } from "./rows";

export const generateMetadata = titled("account.weeks.title");

/** The one muted line under an Upcoming week's title. */
function lineOf(row: UpcomingRow, t: Translator, language: Language): string {
  if (row.marker === "coming" && row.chargeDate !== null) return t("account.weeks.charged", { date: formatPickupDate(row.chargeDate, language) });
  if (row.marker === "closed") return t(row.closedPaid ? "account.weeks.closedPaid" : "account.weeks.closedNoCharge");
  if (row.marker === "weekCredit") return t("account.weeks.weekCredit");
  if (row.marker === "skipped") return t("account.weeks.skipped");
  return t("account.marker.paid");
}

/**
 * A row's Skip or Unskip: a form of its own posting the week; null when the week has no button. The visible text
 * stays short; the accessible name adds the week's title, since up to 11 of these sit on one page.
 */
function actionOf(row: UpcomingRow, t: Translator, language: Language) {
  if (row.action === null) return null;
  const skipping = row.action === "skip";
  return (
    <form action={skipping ? skipWeek : unskipWeek}>
      <input type="hidden" name="week" value={row.week.weekOf} />
      <Button kind="secondary" type="submit" aria-label={t(skipping ? "account.weeks.skipWeek" : "account.weeks.unskipWeek", { week: listedWeekTitle(t, row.week, language) })}>
        {t(skipping ? "account.weeks.skip" : "account.weeks.unskip")}
      </Button>
    </form>
  );
}

/**
 * A member's Upcoming weeks (issue 155): 12 weeks from the later of their first week and the calendar's current
 * week, each marked Paid, Coming, Closed, Week credit or Skipped, with a Skip or Unskip button before its cutoff
 * (issue 137). `?error=cutoff` shows the Notice a refused request sends the member back with.
 */
export default async function UpcomingWeeks(): Promise<ReactElement>;
// Next reads a page's props from its last signature, which cannot be optional there, so the one without is first.
export default async function UpcomingWeeks(props: { searchParams?: Promise<{ error?: string }> }): Promise<ReactElement>;
export default async function UpcomingWeeks({ searchParams }: { searchParams?: Promise<{ error?: string }> } = {}): Promise<ReactElement> {
  const subscribed = await requireSubscriber();
  const [t, language, upcoming, query] = await Promise.all([getTranslator(), getLanguage(), loadUpcomingRows(subscribed, new Date()), searchParams]);
  const rows = upcoming.map((row) => ({
    id: row.week.weekOf,
    title: listedWeekTitle(t, row.week, language),
    lines: [lineOf(row, t, language)],
    badge: <Badge kind={MARKER_BADGES[row.marker].kind}>{t(MARKER_BADGES[row.marker].key)}</Badge>,
    action: actionOf(row, t, language),
  }));

  return (
    <>
      {await SiteHeader({ account: "none", current: "weeks" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          <Heading>{t("account.weeks.title")}</Heading>
          <Hint>{t("account.weeks.intro")}</Hint>
          {query?.error === ACCOUNT_WEEKS_CUTOFF_ERROR && <Notice icon="alert">{t("account.weeks.cutoffPassed")}</Notice>}
          <Card width="fill">
            <WeekList rows={rows} />
          </Card>
        </div>
      </Shell>
    </>
  );
}
