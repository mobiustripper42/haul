import type { ReactElement } from "react";
import { lockedWeek, type UpcomingRow } from "@core/account-weeks.js";
import type { Language, Translator } from "@core/i18n.js";
import { formatPickupDate, listedWeekTitle } from "@core/pickup-week.js";
import { Badge } from "../../../components/ui/badge";
import { BulletList } from "../../../components/ui/bullet-list";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Disclosure } from "../../../components/ui/disclosure";
import { Heading } from "../../../components/ui/heading";
import { Hint } from "../../../components/ui/hint";
import { Shell } from "../../../components/ui/shell";
import { TwoColumns } from "../../../components/ui/two-columns";
import { WeekList } from "../../../components/ui/week-list";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { ACCOUNT_HISTORY_ID, ACCOUNT_WEEKS_CUTOFF_ERROR } from "../../paths";
import { SiteHeader } from "../../site-header";
import { CutoffNotice } from "../cutoff-notice";
import { declinedNotice } from "../declined-notice";
import { requireSubscriber } from "../subscriber";
import { MARKER_BADGES } from "../week-markers";
import { skipWeek, unskipWeek } from "./actions";
import { History } from "./history";
import { loadHistoryRows, loadNextPickup, loadUpcomingRows, loadWeekMenus } from "./rows";

export const generateMetadata = titled("account.weeks.title");

/** The page's query: `error` is the Notice a refused request sends the member back with. `switch` is the account page's (issue 219) and read by nothing here. */
type Query = { error?: string; switch?: string };

/** The one muted line under an Upcoming week's title. A Locked week reads by whether the subscription is still locked (`locked`, from `lockedWeek`). */
function lineOf(row: UpcomingRow, t: Translator, language: Language, locked: string | null): string {
  if (row.marker === "coming" && row.chargeDate !== null) return t("account.weeks.charged", { date: formatPickupDate(row.chargeDate, language, "short") });
  if (row.marker === "closed") return t(row.closedPaid ? "account.weeks.closedPaid" : "account.weeks.closedNoCharge");
  if (row.marker === "weekCredit") return t("account.weeks.weekCredit");
  if (row.marker === "skipped") return t("account.weeks.skipped");
  if (row.marker === "locked") return t(locked === null ? "account.weeks.lockedAfterUpdate" : "account.noPickupLocked");
  if (row.marker === "declined") return t("account.weeks.declined");
  return t("account.marker.paid");
}

/**
 * A row's Skip (secondary) or Unskip (strong, issue 230): a form of its own posting the week; null when the week has no button. The visible text
 * stays short; the accessible name adds the week's title, since up to 11 of these sit on one page.
 */
function actionOf(row: UpcomingRow, t: Translator, language: Language) {
  if (row.action === null) return null;
  const skipping = row.action === "skip";
  return (
    <form action={skipping ? skipWeek : unskipWeek}>
      <input type="hidden" name="week" value={row.week.weekOf} />
      <Button kind={skipping ? "secondary" : "strong"} type="submit" aria-label={t(skipping ? "account.weeks.skipWeek" : "account.weeks.unskipWeek", { week: listedWeekTitle(t, row.week, language) })}>
        {t(skipping ? "account.weeks.skip" : "account.weeks.unskip")}
      </Button>
    </form>
  );
}

/**
 * A member's Upcoming weeks (issue 155): 12 weeks from the later of their first week and the calendar's current
 * week, each marked Paid, Closed, Week credit, Skipped, Locked or Card declined (issue 198), or coming with no badge, with a Skip or Unskip button before its cutoff
 * (issue 137). `?error=cutoff` shows the Notice a refused request sends the member back with. The meal card and its
 * Switch are on the account page (issue 219).
 *
 * Issue 243: History is the page's second list, in the right column (`ACCOUNT_HISTORY_ID`, which the menu's History link goes to), and
 * under Upcoming weeks below 1024px. A week with a menu that has dishes for the member's choice holds a rolldown named by the menu, the
 * first listed one open on load, headed Proposed until the week's menu email has gone out (DEC-054). For a cancelled member with no paid
 * week to come the Upcoming card holds one line saying so.
 */
export default async function UpcomingWeeks(): Promise<ReactElement>;
// Next reads a page's props from its last signature, which cannot be optional there, so the one without is first.
export default async function UpcomingWeeks(props: { searchParams?: Promise<Query> }): Promise<ReactElement>;
export default async function UpcomingWeeks({ searchParams }: { searchParams?: Promise<Query> } = {}): Promise<ReactElement> {
  const subscribed = await requireSubscriber();
  const { confirmation } = subscribed;
  const now = new Date();
  const locked = lockedWeek(confirmation);
  const [t, language, upcoming, history, query, next] = await Promise.all([
    getTranslator(),
    getLanguage(),
    loadUpcomingRows(subscribed, now),
    loadHistoryRows(subscribed.product, confirmation.subscriptionId, confirmation.pickupDate, now),
    searchParams,
    locked === null ? null : loadNextPickup(subscribed, now),
  ]);
  const [{ notice }, menus] = await Promise.all([declinedNotice(subscribed, next, t, language), loadWeekMenus(subscribed, upcoming, history.ledger)]);
  // Issue 243: the first listed week with a rolldown is the one open when the page loads.
  const openWeek = upcoming.find((row) => menus.has(row.week.weekOf))?.week.weekOf;
  const rows = upcoming.map((row) => {
    const menu = menus.get(row.week.weekOf);
    return {
      id: row.week.weekOf,
      title: listedWeekTitle(t, row.week, language),
      lines: [lineOf(row, t, language, locked)],
      // Issue 230: a Skipped week with Unskip takes no badge: its line says Skipped, and its Unskip is the strong button.
      badge: row.marker === "coming" || (row.marker === "skipped" && row.action === "unskip") ? undefined : <Badge kind={MARKER_BADGES[row.marker].kind}>{t(MARKER_BADGES[row.marker].key)}</Badge>,
      action: actionOf(row, t, language),
      below: menu && (
        <Disclosure summary={t("account.weeks.menu", { name: menu.name })} open={row.week.weekOf === openWeek}>
          {menu.proposed && <Hint>{t("account.weeks.menuProposed")}</Hint>}
          <BulletList items={menu.dishes} />
        </Disclosure>
      ),
    };
  });

  return (
    <>
      {await SiteHeader({ account: "none", current: "weeks" })}
      <Shell>
        <div className="w-full max-w-page">
          {TwoColumns({
            left: (
              <>
                <Heading>{t("account.weeks.title")}</Heading>
                {notice}
                {query?.error === ACCOUNT_WEEKS_CUTOFF_ERROR && <CutoffNotice t={t} />}
                <Card width="fill">
                  <WeekList rows={rows} empty={t("account.weeks.empty")} />
                </Card>
              </>
            ),
            right: History({ past: history.rows, ledger: history.ledger, t, language }),
            rightId: ACCOUNT_HISTORY_ID,
          })}
        </div>
      </Shell>
    </>
  );
}
