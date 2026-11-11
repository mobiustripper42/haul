import { LANGUAGES } from "@core/i18n.js";
import { mealLabel, SEPARATOR } from "@core/member-list.js";
import { memberDisplayName } from "@core/members.js";
import { formatUsdWhole } from "@core/money.js";
import { nextPickup, pickupWhereLine, weekTitle } from "@core/pickup-week.js";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { Heading } from "../../components/ui/heading";
import { Shell } from "../../components/ui/shell";
import { loadCalendar } from "../admin/weeks/calendar";
import { getLanguage, getTranslator } from "../language";
import { titled } from "../page-title";
import { getRepository } from "../services";
import { SiteHeader } from "../site-header";
import { requireSubscriber } from "./subscriber";

export const generateMetadata = titled("account.title");

/**
 * A member's account home: their Supper Club, its next pickup and weekly price, and their details. A member
 * with no active, paid subscription is sent to the Supper Club page. The price is the one stored on the
 * subscription, not the price of its picks today.
 */
export default async function Account() {
  const { member, confirmation } = await requireSubscriber();
  const [t, language] = await Promise.all([getTranslator(), getLanguage()]);
  const { weeks } = await loadCalendar(getRepository(), new Date());
  const next = nextPickup(weeks, confirmation.pickupDate);
  const name = memberDisplayName(member);
  const phoneAndLanguage = [member.phone, LANGUAGES[member.language].name].filter(Boolean).join(SEPARATOR);

  return (
    <>
      {await SiteHeader({ account: "none", current: "account" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          <Heading>{t("account.title")}</Heading>
          <Card width="fill">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold">{mealLabel(confirmation.options)}</p>
              <Badge kind="success">{t("account.active")}</Badge>
            </div>
            {next && (
              <>
                <p>{t("account.nextPickup", { week: weekTitle(t, next, language) })}</p>
                <p className="text-ink-muted">{pickupWhereLine(t, next, language)}</p>
              </>
            )}
            <p className="text-ink-muted">{t("supperClub.next.charge", { price: formatUsdWhole(confirmation.weeklyCents) })}</p>
          </Card>
          <Card width="fill">
            <Heading level={2}>{t("account.details")}</Heading>
            {name && <p>{name}</p>}
            <p>{member.email}</p>
            <p>{phoneAndLanguage}</p>
          </Card>
        </div>
      </Shell>
    </>
  );
}
