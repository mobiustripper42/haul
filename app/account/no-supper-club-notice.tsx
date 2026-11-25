import type { ReactElement } from "react";
import type { Language, MessageKey, Translator } from "@core/i18n.js";
import { listedWeekTitle } from "@core/pickup-week.js";
import { Button } from "../../components/ui/button";
import { Heading } from "../../components/ui/heading";
import { Notice } from "../../components/ui/notice";
import { Shell } from "../../components/ui/shell";
import { ACCOUNT_PATH } from "../paths";
import { SiteHeader } from "../site-header";
import { SUPPER_CLUB_PATH } from "../supper-club/paths";
import type { Account } from "./subscriber";
import { loadLastPickup } from "./weeks/rows";

/**
 * Issue 260: the Notice of a member with no active subscription, on Your account, Update your card and Cancel the Supper Club.
 * Null for an active subscription. A cancelled one gets the cancelled Notice (issue 238): its last pickup line when there is one,
 * and a Join again button. A member who never joined gets the info Notice with a way to join. Called inline, as `declinedNotice` is.
 */
export async function noSupperClubNotice(account: Account, t: Translator, language: Language, now: Date): Promise<ReactElement | null> {
  const { product, confirmation } = account;
  if (confirmation === null) {
    return (
      <Notice
        icon="info"
        lead={t("account.noSupperClub")}
        action={
          <Button kind="secondary" href={SUPPER_CLUB_PATH}>
            {t("supperClub.joinTitle")}
          </Button>
        }
      >
        {t("account.noSupperClubJoin")}
      </Notice>
    );
  }
  if (confirmation.status !== "cancelled") return null;
  const last = await loadLastPickup(product, confirmation.subscriptionId, now);
  const lastLine = last && t(last.passed ? "account.lastPickupWas" : "account.lastPickupIs", { week: listedWeekTitle(t, last.week, language) });
  return (
    <Notice
      icon="info"
      lead={t("account.cancelledNotice")}
      action={
        <Button kind="secondary" href={SUPPER_CLUB_PATH}>
          {t("account.cancel.joinAgainLink")}
        </Button>
      }
    >
      {[lastLine, t("account.cancel.nothingMore"), t("account.cancel.joinAgain")].filter(Boolean).join(" ")}
    </Notice>
  );
}

/**
 * Issue 260: the one page `/account/card` and `/account/cancel` draw for a member with no active subscription: the header marking Your
 * account, the quiet back button to it, the page's own heading, then the Notice. Nothing else.
 */
export async function noSupperClubPage(t: Translator, heading: MessageKey, notice: ReactElement): Promise<ReactElement> {
  return (
    <>
      {await SiteHeader({ account: "none", current: "account" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          <div className="flex">
            <Button kind="quiet" href={ACCOUNT_PATH} back flush>
              {t("header.yourAccount")}
            </Button>
          </div>
          <Heading>{t(heading)}</Heading>
          {notice}
        </div>
      </Shell>
    </>
  );
}
