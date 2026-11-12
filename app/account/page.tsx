import { LANGUAGES } from "@core/i18n.js";
import { mealLabel, SEPARATOR } from "@core/member-list.js";
import { memberDisplayName } from "@core/members.js";
import { formatUsdWhole } from "@core/money.js";
import { listedWeekTitle, nextPickup, pickupWhereLine, weekTitle } from "@core/pickup-week.js";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Heading } from "../../components/ui/heading";
import { Notice } from "../../components/ui/notice";
import { Shell } from "../../components/ui/shell";
import { loadCalendar } from "../admin/weeks/calendar";
import { getLanguage, getTranslator } from "../language";
import { titled } from "../page-title";
import { ACCOUNT_CANCEL_PATH } from "../paths";
import { getRepository } from "../services";
import { SiteHeader } from "../site-header";
import { SUBSCRIPTION_BADGES } from "../subscription-badges";
import { requireSubscriber } from "./subscriber";
import { loadLastPickup } from "./weeks/rows";

export const generateMetadata = titled("account.title");

/**
 * A member's account home: their Supper Club, its next pickup and weekly price, and their details. A member
 * with no paid subscription is sent to the Supper Club page. The price is the one stored on the subscription, not
 * the price of its picks today. An active one ends with a link to cancel it (issue 139); a cancelled one shows the
 * Notice, with the last pickup, and a Cancelled badge, and no next pickup, no where line, no charge line and no link:
 * no pickup or charge is coming from it, unless a paid week is still to come, which the Notice names.
 */
export default async function Account() {
  const { member, product, confirmation } = await requireSubscriber();
  const cancelled = confirmation.status === "cancelled";
  const [t, language] = await Promise.all([getTranslator(), getLanguage()]);
  const now = new Date();
  const { weeks } = await loadCalendar(getRepository(), now);
  const next = cancelled ? null : nextPickup(weeks, confirmation.pickupDate);
  const last = cancelled ? await loadLastPickup(product, confirmation.subscriptionId, now) : null;
  const badge = SUBSCRIPTION_BADGES[confirmation.status];
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
            <Notice icon="info">
              <strong className="font-semibold text-teal">{t("account.cancelledNotice")}</strong>{" "}
              {[lastLine, t("account.cancel.nothingMore"), t("account.cancel.joinAgain")].filter(Boolean).join(" ")}
            </Notice>
          )}
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
            {!cancelled && <p className="text-ink-muted">{t("supperClub.next.charge", { price: formatUsdWhole(confirmation.weeklyCents) })}</p>}
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
