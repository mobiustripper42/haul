import type { ReactElement } from "react";
import type { UpcomingRow } from "@core/account-weeks.js";
import type { Language, Translator } from "@core/i18n.js";
import { mealLabel, SEPARATOR } from "@core/member-list.js";
import { formatUsdWhole } from "@core/money.js";
import { formatPickupDate, listedWeekTitle } from "@core/pickup-week.js";
import { switchWeek } from "@core/switch-meal.js";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { ButtonRow } from "../../../components/ui/button-row";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Hint } from "../../../components/ui/hint";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { WeekList } from "../../../components/ui/week-list";
import { getLanguage, getTranslator } from "../../language";
import { MealPickers } from "../../meal-pickers";
import { titled } from "../../page-title";
import { ACCOUNT_WEEKS_CUTOFF_ERROR, ACCOUNT_WEEKS_PATH, ACCOUNT_WEEKS_SWITCH_OPEN } from "../../paths";
import { SiteHeader } from "../../site-header";
import { requireSubscriber } from "../subscriber";
import { MARKER_BADGES } from "../week-markers";
import { skipWeek, switchMeal, unskipWeek } from "./actions";
import { loadUpcomingRows } from "./rows";

export const generateMetadata = titled("account.weeks.title");

/** The page's query: `error` is the Notice a refused request sends the member back with, `switch` opens the meal card's pickers. */
type Query = { error?: string; switch?: string };

/** Upcoming weeks with the meal card's pickers open. */
const OPEN_SWITCH_PATH = `${ACCOUNT_WEEKS_PATH}?switch=${ACCOUNT_WEEKS_SWITCH_OPEN}`;

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
 * week, each marked Paid, Closed, Week credit or Skipped, or coming with no badge, with a Skip or Unskip button before its cutoff
 * (issue 137). `?error=cutoff` shows the Notice a refused request sends the member back with. Above the weeks, the meal
 * card (issue 138): the newest picks and the weekly price, and with `?switch=1` and a switch week listed, the pickers
 * in a form posting that week to `switchMeal`.
 */
export default async function UpcomingWeeks(): Promise<ReactElement>;
// Next reads a page's props from its last signature, which cannot be optional there, so the one without is first.
export default async function UpcomingWeeks(props: { searchParams?: Promise<Query> }): Promise<ReactElement>;
export default async function UpcomingWeeks({ searchParams }: { searchParams?: Promise<Query> } = {}): Promise<ReactElement> {
  const subscribed = await requireSubscriber();
  const { product, confirmation } = subscribed;
  const [t, language, upcoming, query] = await Promise.all([getTranslator(), getLanguage(), loadUpcomingRows(subscribed, new Date()), searchParams]);
  const rows = upcoming.map((row) => ({
    id: row.week.weekOf,
    title: listedWeekTitle(t, row.week, language),
    lines: [lineOf(row, t, language)],
    badge: row.marker === "coming" ? undefined : <Badge kind={MARKER_BADGES[row.marker].kind}>{t(MARKER_BADGES[row.marker].key)}</Badge>,
    action: actionOf(row, t, language),
  }));

  // The new picks have not started yet while their set starts after the first listed week.
  const firstWeek = upcoming[0]?.week.weekOf;
  const startsAt = upcoming.find((row) => row.week.weekOf === confirmation.optionsFromWeek);
  const notStarted = firstWeek !== undefined && startsAt !== undefined && startsAt.week.weekOf > firstWeek ? startsAt : null;
  const switchOn = switchWeek(upcoming);
  const switchesFrom = upcoming.find((row) => row.week.weekOf === switchOn);
  const open = query?.switch === ACCOUNT_WEEKS_SWITCH_OPEN && switchesFrom !== undefined;
  // Nothing more is charged once cancelled, so the intro line, which says when a week is charged, and the weekly price are left out.
  const cancelled = confirmation.status === "cancelled";

  return (
    <>
      {await SiteHeader({ account: "none", current: "weeks" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          <Heading>{t("account.weeks.title")}</Heading>
          {!cancelled && <Hint>{t("account.weeks.intro")}</Hint>}
          {query?.error === ACCOUNT_WEEKS_CUTOFF_ERROR && <Notice icon="alert">{t("account.weeks.cutoffPassed")}</Notice>}
          <Card width="fill">
            <Heading level={2}>{t("header.yourMeal")}</Heading>
            <p>{[mealLabel(confirmation.options), ...(cancelled ? [] : [t("supperClub.price", { price: formatUsdWhole(confirmation.weeklyCents) })])].join(SEPARATOR)}</p>
            {notStarted && <Hint>{t("account.weeks.switchFrom", { week: listedWeekTitle(t, notStarted.week, language) })}</Hint>}
            {open ? (
              <form action={switchMeal} className="flex flex-col gap-5">
                <input type="hidden" name="week" value={switchesFrom.week.weekOf} />
                {MealPickers({ product, selected: confirmation.choices, t })}
                <Hint>{t("account.weeks.switchApplies", { week: listedWeekTitle(t, switchesFrom.week, language) })}</Hint>
                <ButtonRow>
                  <Button kind="primary" type="submit">
                    {t("account.weeks.switchSave")}
                  </Button>
                  <Button kind="secondary" href={ACCOUNT_WEEKS_PATH}>
                    {t("account.weeks.switchCancel")}
                  </Button>
                </ButtonRow>
              </form>
            ) : (
              switchesFrom !== undefined && (
                <Button kind="secondary" href={OPEN_SWITCH_PATH}>
                  {t("account.weeks.switch")}
                </Button>
              )
            )}
          </Card>
          <Card width="fill">
            <WeekList rows={rows} />
          </Card>
        </div>
      </Shell>
    </>
  );
}
