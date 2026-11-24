import { redirect } from "next/navigation";
import { weekNamed } from "@core/ledger-charge.js";
import { formatUsdWhole } from "@core/money.js";
import { cutoffDate, formatPickupDate } from "@core/pickup-week.js";
import { isChargeOut } from "@core/signup.js";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { cardEntrySettings } from "../../card-entry-settings";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { ACCOUNT_CARD_ROW_PARAM, ACCOUNT_CARD_STATE_PARAM, ACCOUNT_PATH } from "../../paths";
import { getRepository } from "../../services";
import { SiteHeader } from "../../site-header";
import { requireSubscriber } from "../subscriber";
import { loadNextPickup } from "../weeks/rows";
import { CardForm } from "./card-form";

export const generateMetadata = titled("account.card.title");

const STATES = ["saved", "paid", "paidNoCard", "declined", "unknown", "error"] as const;

/** A query value that is one string, or nothing. */
const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * A member's Update your card (issue 145): the card on file, the card entry that replaces it, and, after a save, what it
 * did (`state` in the URL: `saved`, `paid` with the `row` it charged, `paidNoCard` with the `row` it charged and no card
 * saved from it (issue 254), `declined`, `unknown`, `error`). A saved or paid state has no form: the card is on file and
 * only the back link is left; `paidNoCard` keeps the form, to enter the card again. While the subscription holds a row
 * whose charge is out (a card update's `declined` one with `charge_sent_at` set), whatever the URL says, the retry Notice
 * stands over the form, whose card is charged under that charge's key, for that row's amount. While it holds the weekly run's
 * `pending` row with a card on file, the confirming Notice takes the form's place: the run settles that row, and no save may
 * touch it. Only an active subscription reaches it; a cancelled one is sent to account home.
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
  // The row whose charge is out, which comes first, or else the weekly run's pending row on the card on file.
  const charged = await repo.findPendingCharge(subscriptionId);
  const out = charged !== null && isChargeOut(charged) ? charged : null;
  const confirming = charged !== null && out === null;

  // A paid state counts only for the one row of this subscription's the URL names.
  const paidState = one(query[ACCOUNT_CARD_STATE_PARAM]);
  const paidRow = paidState === "paid" || paidState === "paidNoCard" ? await repo.findPaidCharge(subscriptionId, one(query[ACCOUNT_CARD_ROW_PARAM]) ?? "") : null;
  const known = STATES.find((found) => found === paidState);
  const state = (known === "paid" || known === "paidNoCard") && !paidRow ? undefined : known;

  let notice: { lead: string; text: string } | null = null;
  if (state === "saved" && cardWords) {
    // The next charge is the member's first week whose cutoff has not passed, which can be a later one than their next pickup.
    const week = await loadNextPickup({ member, product, confirmation }, now, { cutoffAhead: true });
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
  } else if (state === "paidNoCard" && paidRow) {
    notice = {
      lead: t("account.card.paidNoCardLead"),
      text: t("account.card.paidNoCard", { amount: formatUsdWhole(paidRow.amountCents), week: await weekNamed(repo, product.id, paidRow.pickupDate, language) }),
    };
  } else if (state === "declined") {
    notice = { lead: t("account.card.refusedLead"), text: t("account.card.refused") };
  }
  const done = notice !== null && (state === "saved" || state === "paid");
  const showForm = !confirming && (out !== null || !done);
  // A charge out, or a save that heard nothing with none out: the member enters their card again, and is not charged twice.
  const retry = out !== null || (state === "unknown" && !confirming);

  // The card entry's amount: the row whose charge is out, else what a save would charge now, or the weekly price when nothing is owed.
  const owed = (await repo.listDeclinedCharges(subscriptionId)).filter((row) => !row.closed).reduce((sum, row) => sum + row.amountCents, 0);
  const amountCents = out ? out.amountCents : owed > 0 ? owed : confirmation.weeklyCents;

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
          <Heading>{t("account.card.title")}</Heading>
          {notice && (
            <Notice icon={done ? "check" : "alert"} lead={notice.lead}>
              {notice.text}
            </Notice>
          )}
          {state === "error" && !out && <Notice icon="alert">{t("supperClub.payError")}</Notice>}
          {retry && <Notice icon="alert">{t("supperClub.retryNotice")}</Notice>}
          {confirming && <Notice icon="alert">{t("account.card.confirming")}</Notice>}
          {showForm && (
            <Card width="fill">
              {cardWords && <p>{t("account.card.onFile", { card: cardWords })}</p>}
              <CardForm
                amountCents={amountCents}
                card={cardEntrySettings(member)}
                text={{
                  cardLabel: t("account.card.label"),
                  cardHint: t("account.card.hint"),
                  testCard: t("supperClub.testCard"),
                  cardFailed: t("supperClub.cardFailed"),
                  cardRefused: t("supperClub.cardRefused"),
                  cardLoading: t("supperClub.cardLoading"),
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
