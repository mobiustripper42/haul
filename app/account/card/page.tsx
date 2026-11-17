import { redirect } from "next/navigation";
import { weekNamed } from "@core/ledger-charge.js";
import { formatUsdWhole } from "@core/money.js";
import { cutoffDate, formatPickupDate } from "@core/pickup-week.js";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { loadCalendar } from "../../admin/weeks/calendar";
import { cardEntrySettings } from "../../card-entry-settings";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { ACCOUNT_CARD_ROW_PARAM, ACCOUNT_CARD_STATE_PARAM, ACCOUNT_PATH } from "../../paths";
import { getRepository } from "../../services";
import { SiteHeader } from "../../site-header";
import { requireSubscriber } from "../subscriber";
import { retryCard } from "./actions";
import { CardForm } from "./card-form";

export const generateMetadata = titled("account.card.title");

const STATES = ["saved", "paid", "declined", "unknown", "error"] as const;

/** A query value that is one string, or nothing. */
const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * A member's Update your card (issue 145): the card on file, the card entry that replaces it, and, after a save, what it
 * did (`state` in the URL: `saved`, `paid` with the `row` it charged, `declined`, `unknown`, `error`). A saved or paid state
 * has no form: the card is on file and only the back link is left. While the subscription holds a `pending` row, whatever
 * the URL says, the signup's Try again takes the form's place: the row's key and card stay fixed until it settles. Only an
 * active subscription reaches it; a cancelled one is sent to account home.
 */
export default async function UpdateCard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { member, product, confirmation } = await requireSubscriber();
  if (confirmation.status === "cancelled") redirect(ACCOUNT_PATH);
  const query = await searchParams;
  const [t, language] = await Promise.all([getTranslator(), getLanguage()]);
  const repo = getRepository();
  const now = new Date();
  const { subscriptionId } = confirmation;

  const stored = await repo.findSubscriptionCard(subscriptionId);
  const cardWords = stored && t("account.card.ending", { last4: stored.last4 });
  const charged = await repo.findPendingCharge(subscriptionId);

  // A paid state counts only for the one row of this subscription's the URL names.
  const paidRow = one(query[ACCOUNT_CARD_STATE_PARAM]) === "paid" ? await repo.findPaidCharge(subscriptionId, one(query[ACCOUNT_CARD_ROW_PARAM]) ?? "") : null;
  const known = STATES.find((found) => found === one(query[ACCOUNT_CARD_STATE_PARAM]));
  const state = known === "paid" && !paidRow ? undefined : known;

  let notice: { lead: string; text: string } | null = null;
  if (state === "saved" && cardWords) {
    // The next charge is the first open week whose cutoff has not passed, not `nextPickup`, which can name a week past its cutoff.
    const week = (await loadCalendar(repo, now)).weeks.find(
      (found) => found.closedAt === null && found.weekOf >= confirmation.pickupDate && !found.cutoffPassed,
    );
    notice = week
      ? { lead: t("account.card.saved"), text: t("account.card.savedNext", { day: formatPickupDate(cutoffDate(product, week.weekOf), language), card: cardWords }) }
      : { lead: t("account.card.saved"), text: "" };
  } else if (state === "paid" && paidRow && cardWords) {
    notice = {
      lead: t("account.card.saved"),
      text: t("account.card.paid", {
        amount: formatUsdWhole(paidRow.amountCents),
        card: cardWords,
        week: await weekNamed(repo, product.id, paidRow.pickupDate, language),
      }),
    };
  } else if (state === "declined") {
    notice = { lead: t("account.card.refusedLead"), text: t("account.card.refused") };
  }
  const done = notice !== null && (state === "saved" || state === "paid");

  // The card entry's amount: what a save would charge now, or the weekly price when nothing is owed.
  const owed = (await repo.listDeclinedCharges(subscriptionId)).filter((row) => !row.closed).reduce((sum, row) => sum + row.amountCents, 0);

  return (
    <>
      {await SiteHeader({ account: "none", current: "account" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          <div className="flex">
            <Button kind="quiet" href={ACCOUNT_PATH} back flush>
              {t("header.yourMeal")}
            </Button>
          </div>
          <Heading>{t("account.card.title")}</Heading>
          {notice && (
            <Notice icon={done ? "check" : "alert"} lead={notice.lead}>
              {notice.text}
            </Notice>
          )}
          {state === "error" && <Notice icon="alert">{t("supperClub.payError")}</Notice>}
          {charged && (
            <Card width="fill">
              <Notice icon="alert">{t("supperClub.retryNotice")}</Notice>
              <form action={retryCard}>
                <Button kind="primary" type="submit" full>
                  {t("supperClub.tryAgain")}
                </Button>
              </form>
            </Card>
          )}
          {!done && !charged && (
            <Card width="fill">
              {cardWords && <p>{t("account.card.onFile", { card: cardWords })}</p>}
              <CardForm
                amountCents={owed > 0 ? owed : confirmation.weeklyCents}
                card={cardEntrySettings(member)}
                text={{
                  cardLabel: t("account.card.label"),
                  cardHint: t("account.card.hint"),
                  testCard: t("supperClub.testCard"),
                  cardFailed: t("supperClub.cardFailed"),
                  cardRefused: t("supperClub.cardRefused"),
                  save: t("account.card.save"),
                }}
              />
            </Card>
          )}
        </div>
      </Shell>
    </>
  );
}
