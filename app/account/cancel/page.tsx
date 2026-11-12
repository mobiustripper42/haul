import { redirect } from "next/navigation";
import { listedWeekTitle } from "@core/pickup-week.js";
import { Button } from "../../../components/ui/button";
import { ButtonRow } from "../../../components/ui/button-row";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { ACCOUNT_PATH, ACCOUNT_WEEKS_PATH } from "../../paths";
import { getRepository } from "../../services";
import { SiteHeader } from "../../site-header";
import { requireSubscriber } from "../subscriber";
import { loadLastPickup } from "../weeks/rows";
import { cancelSubscription } from "./actions";

export const generateMetadata = titled("account.cancel.title");

/**
 * The member's cancel confirm (issue 139): what a cancel leaves them with, their last pickup (a week already paid for
 * is still made) and the week credits the farm refunds by hand (DEC-005), and the button that cancels. Only an active
 * subscription reaches it; a cancelled one is sent to account home.
 */
export default async function CancelSupperClub() {
  const { product, confirmation } = await requireSubscriber();
  if (confirmation.status === "cancelled") redirect(ACCOUNT_PATH);
  const repo = getRepository();
  const [t, language, last, ledger] = await Promise.all([
    getTranslator(),
    getLanguage(),
    loadLastPickup(product, confirmation.subscriptionId, new Date()),
    repo.listMemberWeeks(confirmation.subscriptionId),
  ]);
  // The last pickup is a sentence only while a paid week is still to come: one already passed is no news to the member.
  const stillToCome = last !== null && !last.passed ? last.week : null;
  const credits = ledger.weekCredits.length;

  return (
    <>
      {await SiteHeader({ account: "none", current: "account" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          <div className="flex">
            <Button kind="quiet" href={ACCOUNT_PATH} back flush>
              {t("account.title")}
            </Button>
          </div>
          <Heading>{t("account.cancel.title")}</Heading>
          <Card width="fill">
            <p>
              {stillToCome && `${t("account.cancel.lastPickup", { week: listedWeekTitle(t, stillToCome, language) })} `}
              {t("account.cancel.nothingMore")}
            </p>
            <p>
              {t("account.cancel.joinAgain")} {t("account.cancel.skipInstead")}
            </p>
            {credits > 0 && (
              <Notice icon="info">
                {/* One span, so the bold lead and its sentence run on beside the icon, not as two flex columns. */}
                <span>
                  <strong className="font-semibold text-teal">{credits === 1 ? t("account.cancel.creditOne") : t("account.cancel.creditMany", { n: credits })}</strong>{" "}
                  {t("account.cancel.refund")}
                </span>
              </Notice>
            )}
            <form action={cancelSubscription}>
              <ButtonRow>
                <Button kind="primary" type="submit">
                  {t("account.cancel.confirm")}
                </Button>
                <Button kind="quiet" href={ACCOUNT_WEEKS_PATH}>
                  {t("account.cancel.skipWeeks")}
                </Button>
              </ButtonRow>
            </form>
          </Card>
        </div>
      </Shell>
    </>
  );
}
