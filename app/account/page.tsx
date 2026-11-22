import type { ReactElement } from "react";
import { cookies } from "next/headers";
import { lockedWeek } from "@core/account-weeks.js";
import { mealLabel } from "@core/member-list.js";
import { formatUsdWhole } from "@core/money.js";
import { listedWeekTitle, pickupWhereLine, weekTitle } from "@core/pickup-week.js";
import { CODE_TTL_MS } from "@core/sign-in/code.js";
import { switchWeek } from "@core/switch-meal.js";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ButtonRow } from "../../components/ui/button-row";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { Notice } from "../../components/ui/notice";
import { Shell } from "../../components/ui/shell";
import { AccountFields, readDraft } from "../account-fields";
import { getLanguage, getTranslator } from "../language";
import { MealPickers } from "../meal-pickers";
import { titled } from "../page-title";
import { ACCOUNT_CANCEL_PATH, ACCOUNT_CARD_PATH, ACCOUNT_PATH, ACCOUNT_SWITCH_OPEN, ACCOUNT_WEEKS_CUTOFF_ERROR } from "../paths";
import { getRepository } from "../services";
import { ACCOUNT_DRAFT_COOKIE } from "../session";
import { SiteHeader } from "../site-header";
import { CodeStep } from "../sign-in/code-step";
import { limitedNotice } from "../sign-in/limited-notice";
import { limitedMinutes } from "../sign-in/shared";
import { SUBSCRIPTION_BADGES } from "../subscription-badges";
import { CutoffNotice } from "./cutoff-notice";
import { declinedNotice } from "./declined-notice";
import { confirmEmailChange, keepOldEmail, resendEmailChange, saveDetails } from "./details-actions";
import { requireSubscriber } from "./subscriber";
import { switchMeal } from "./weeks/actions";
import { loadLastPickup, loadNextPickup, loadUpcomingRows } from "./weeks/rows";

export const generateMetadata = titled("account.title");

/**
 * The page's query (issue 219): `switch` opens the Supper Club card's pickers, `switchError` is the refusal a Switch sends
 * the member back with, and the rest is Your details' (issue 156): `saved`, `error` naming the fields a save broke or the
 * code step's refusal, `sent` and `limited`.
 */
type Query = { switch?: string; switchError?: string; saved?: string; error?: string; sent?: string; limited?: string };

/**
 * A member's Your account (issue 219): their Supper Club, its next pickup and weekly price, and below it Your details,
 * the form, or, while an email change is pending and unexpired, the code step in its place. A member with no paid
 * subscription is sent to the Supper Club page. The meal is the set of picks in effect for the next pickup week, with
 * a pending-switch line when a newer set starts after it; with no next pickup it is the newest set, and no line shows.
 * The price is the one stored on the subscription, not the price of its picks today. An active card holds Switch (with
 * `?switch=1` and a switch week listed, the pickers in a form posting that week to `switchMeal`), Cancel and Update your
 * card (issue 139); a cancelled one shows the Notice, with the last pickup, and a Cancelled badge, and no next pickup, no
 * where line, no charge line and no buttons: no pickup or charge is coming from it, unless a paid week is still to come,
 * which the Notice names. An active one holding a declined row is locked (issue 196): its next pickup stands while the
 * declined week's is still to come, then one line says none is coming until the card is updated. Everything is in the
 * page's language (`getTranslator()`), never the member's email language.
 */
export default async function Account(): Promise<ReactElement>;
// Next reads a page's props from its last signature, which cannot be optional there, so the one without is first.
export default async function Account(props: { searchParams?: Promise<Query> }): Promise<ReactElement>;
export default async function Account({ searchParams }: { searchParams?: Promise<Query> } = {}): Promise<ReactElement> {
  const subscribed = await requireSubscriber();
  const { member, product, confirmation } = subscribed;
  const cancelled = confirmation.status === "cancelled";
  const repo = getRepository();
  const now = new Date();
  const [t, language, query, cookieStore, pendingChange, upcoming] = await Promise.all([
    getTranslator(),
    getLanguage(),
    searchParams,
    cookies(),
    repo.findEmailChange(member.id),
    // A cancelled subscription has no switch week and no pending line, so its weeks are not read.
    cancelled ? [] : loadUpcomingRows(subscribed, now),
  ]);
  const { switch: switchQuery, switchError, saved, error, sent, limited } = query ?? {};
  const next = cancelled ? null : await loadNextPickup(subscribed, now);
  // Issue 196: a subscription holding a declined row is locked once no week on or before the declined week is still coming.
  const locked = lockedWeek(confirmation) !== null && next === null;
  const last = cancelled ? await loadLastPickup(product, confirmation.subscriptionId, now) : null;
  // Issue 145: an active subscription holding a declined row. Its week is still made while its pickup is to come, unless an admin closed it.
  const { declined, notice } = await declinedNotice(subscribed, next, t, language);
  const badge = SUBSCRIPTION_BADGES[declined ? "declined" : confirmation.status];
  const lastLine = last && t(last.passed ? "account.lastPickupWas" : "account.lastPickupIs", { week: listedWeekTitle(t, last.week, language) });

  // The meal is what the next pickup is made of; with no next pickup, the newest set, as it was before a switch could be pending.
  const meal = mealLabel(next === null ? confirmation.options : await repo.findOptionsForWeek(confirmation.subscriptionId, next.weekOf));
  // Issue 219, AC4: the newest set starts after the next pickup: it is pending, from the upcoming week it starts at.
  const startsAt = next !== null && confirmation.optionsFromWeek > next.weekOf ? upcoming.find((row) => row.week.weekOf === confirmation.optionsFromWeek) : undefined;

  const switchOn = switchWeek(upcoming, lockedWeek(confirmation));
  const switchesFrom = cancelled ? undefined : upcoming.find((row) => row.week.weekOf === switchOn);
  const open = switchQuery === ACCOUNT_SWITCH_OPEN && switchesFrom !== undefined;
  const minutes = limitedMinutes(limited);
  const codeStep = pendingChange !== null && pendingChange.expiresAt.getTime() > Date.now();

  return (
    <>
      {await SiteHeader({ account: "none", current: "account" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          <Heading>{t("account.title")}</Heading>
          {cancelled && (
            <Notice icon="info" lead={t("account.cancelledNotice")}>
              {[lastLine, t("account.cancel.nothingMore"), t("account.cancel.joinAgain")].filter(Boolean).join(" ")}
            </Notice>
          )}
          {notice}
          {switchError === ACCOUNT_WEEKS_CUTOFF_ERROR && <CutoffNotice t={t} />}
          {saved === "1" && <Notice icon="check">{t("details.saved")}</Notice>}
          {minutes !== null && limitedNotice(language, minutes)}
          {/* Issue 230: side by side at lg and wider, Supper Club on the left; stacked below, Supper Club first. */}
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <Card width="fill">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-semibold">{meal}</p>
                  <Badge kind={badge.kind}>{t(badge.key)}</Badge>
                </div>
                {next && (
                  <>
                    <p>{t("account.nextPickup", { week: weekTitle(t, next, language) })}</p>
                    <p className="text-ink-muted">{pickupWhereLine(t, next, language)}</p>
                  </>
                )}
                {locked && <p>{t("account.noPickupLocked")}</p>}
                {!cancelled && lockedWeek(confirmation) === null && <p className="text-ink-muted">{t("supperClub.next.charge", { price: formatUsdWhole(confirmation.weeklyCents) })}</p>}
                {startsAt && <Hint>{t("account.pendingSwitch", { meal: mealLabel(confirmation.options), week: listedWeekTitle(t, startsAt.week, language) })}</Hint>}
                {!cancelled &&
                  (open ? (
                    <form action={switchMeal} className="flex flex-col gap-5">
                      <input type="hidden" name="week" value={switchesFrom.week.weekOf} />
                      {MealPickers({ product, selected: confirmation.choices, t })}
                      <Hint>{t("account.weeks.switchApplies", { week: listedWeekTitle(t, switchesFrom.week, language) })}</Hint>
                      <ButtonRow>
                        <Button kind="primary" type="submit">
                          {t("account.weeks.switchSave")}
                        </Button>
                        <Button kind="secondary" href={ACCOUNT_PATH}>
                          {t("account.weeks.switchCancel")}
                        </Button>
                      </ButtonRow>
                    </form>
                  ) : (
                    <ButtonRow>
                      {switchesFrom !== undefined && (
                        <Button kind="secondary" href={`${ACCOUNT_PATH}?switch=${ACCOUNT_SWITCH_OPEN}`}>
                          {t("account.weeks.switch")}
                        </Button>
                      )}
                      <Button kind="secondary" href={ACCOUNT_CANCEL_PATH}>
                        {t("account.cancelLink")}
                      </Button>
                    </ButtonRow>
                  ))}
                {!cancelled && (
                  <div className="flex">
                    <Button kind="quiet" href={ACCOUNT_CARD_PATH} flush>
                      {t("account.card.title")}
                    </Button>
                  </div>
                )}
              </Card>
            </div>
            <div className="min-w-0 flex-1">
              <Card width="fill">
                {codeStep ? (
                  await CodeStep({
                    heading: t("details.codeTitle"),
                    headingLevel: 2,
                    sentence: t("details.codeSent", { email: pendingChange.newEmail, minutes: CODE_TTL_MS / 60_000 }),
                    buttonLabel: t("createAccount.confirm"),
                    verify: confirmEmailChange,
                    resend: resendEmailChange,
                    backHref: ACCOUNT_PATH,
                    back: (
                      <form action={keepOldEmail}>
                        <Button kind="quiet" type="submit" back flush>
                          {t("details.keepOldEmail")}
                        </Button>
                      </form>
                    ),
                    invalid: error === "invalid",
                    invalidText: t("details.invalidCode"),
                    notice: error === "square" && <Notice icon="alert">{t("details.squareFailed")}</Notice>,
                    sent: sent === "1",
                    hint: t("createAccount.spam"),
                  })
                ) : (
                  <>
                    <Heading level={2}>{t("account.details")}</Heading>
                    <form action={saveDetails} noValidate className="flex flex-col gap-6">
                      {await AccountFields({ values: detailsValues(), failing: failingFields(), emailHelp: "details.emailHelp" })}
                      <Checkbox name="menuEmails" defaultChecked={member.menuEmails} hint={t("details.menuEmailsHint")}>
                        {t("details.menuEmails")}
                      </Checkbox>
                      <Button kind="primary" full type="submit">
                        {t("details.save")}
                      </Button>
                    </form>
                  </>
                )}
              </Card>
            </div>
          </div>
        </div>
      </Shell>
    </>
  );

  /** The form refills only after a save that broke a rule: `error` names its fields. */
  function failingFields(): Set<string> {
    return new Set(error === undefined || error === "invalid" || error === "square" ? [] : error.split(","));
  }

  function detailsValues() {
    const stored = { firstName: member.firstName ?? "", lastName: member.lastName ?? "", email: member.email, phone: member.phone ?? "", language: member.language };
    // The draft cookie can have expired by the time the page loads; the member's stored values stand in for it.
    const draft = failingFields().size > 0 ? readDraft(cookieStore.get(ACCOUNT_DRAFT_COOKIE)?.value) : {};
    return Object.keys(draft).length > 0 ? draft : stored;
  }
}
