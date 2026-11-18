import { lockedWeek } from "@core/account-weeks.js";
import { LANGUAGES } from "@core/i18n.js";
import { mealLabel, SEPARATOR } from "@core/member-list.js";
import { memberDisplayName } from "@core/members.js";
import { formatUsdWhole } from "@core/money.js";
import { listedWeekTitle, pickupWhereLine, weekTitle } from "@core/pickup-week.js";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Heading } from "../../components/ui/heading";
import { Notice } from "../../components/ui/notice";
import { Shell } from "../../components/ui/shell";
import { getLanguage, getTranslator } from "../language";
import { titled } from "../page-title";
import { ACCOUNT_CANCEL_PATH } from "../paths";
import { SiteHeader } from "../site-header";
import { SUBSCRIPTION_BADGES } from "../subscription-badges";
import { declinedNotice } from "./declined-notice";
import { requireSubscriber } from "./subscriber";
import { loadLastPickup, loadNextPickup } from "./weeks/rows";

export const generateMetadata = titled("account.title");

/**
 * A member's account home: their Supper Club, its next pickup and weekly price, and their details. A member
 * with no paid subscription is sent to the Supper Club page. The price is the one stored on the subscription, not
 * the price of its picks today. An active one ends with a link to cancel it (issue 139); a cancelled one shows the
 * Notice, with the last pickup, and a Cancelled badge, and no next pickup, no where line, no charge line and no link:
 * no pickup or charge is coming from it, unless a paid week is still to come, which the Notice names. An active one
 * holding a declined row is locked (issue 196): its next pickup stands while the declined week's is still to come, then
 * one line says none is coming until the card is updated.
 */
export default async function Account() {
  const { member, product, confirmation } = await requireSubscriber();
  const cancelled = confirmation.status === "cancelled";
  const [t, language] = await Promise.all([getTranslator(), getLanguage()]);
  const now = new Date();
  const next = cancelled ? null : await loadNextPickup({ member, product, confirmation }, now);
  // Issue 196: a subscription holding a declined row is locked once no week on or before the declined week is still coming.
  const locked = lockedWeek(confirmation) !== null && next === null;
  const last = cancelled ? await loadLastPickup(product, confirmation.subscriptionId, now) : null;
  // Issue 145: an active subscription holding a declined row. Its week is still made while its pickup is to come, unless an admin closed it.
  const { declined, notice } = await declinedNotice({ member, product, confirmation }, next, t, language);
  const badge = SUBSCRIPTION_BADGES[declined ? "declined" : confirmation.status];
  const lastLine = last && t(last.passed ? "account.lastPickupWas" : "account.lastPickupIs", { week: listedWeekTitle(t, last.week, language) });
  const name = memberDisplayName(member);
  const phoneAndLanguage = [member.phone, LANGUAGES[member.language].name].filter(Boolean).join(SEPARATOR);

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
          <Card width="fill">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold">{mealLabel(confirmation.options)}</p>
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
          </Card>
          <Card width="fill">
            <Heading level={2}>{t("account.details")}</Heading>
            {name && <p>{name}</p>}
            <p>{member.email}</p>
            <p>{phoneAndLanguage}</p>
          </Card>
          {!cancelled && (
            <div className="flex">
              <Button kind="quiet" href={ACCOUNT_CANCEL_PATH} flush>
                {t("account.cancelLink")}
              </Button>
            </div>
          )}
        </div>
      </Shell>
    </>
  );
}
