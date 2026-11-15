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
import { ACCOUNT_CARD_ROWS_PARAM, ACCOUNT_CARD_STATE_PARAM, ACCOUNT_PATH } from "../../paths";
import { getRepository } from "../../services";
import { SiteHeader } from "../../site-header";
import { requireSubscriber } from "../subscriber";
import { CardForm } from "./card-form";

export const generateMetadata = titled("account.card.title");

const STATES = ["saved", "retried", "declined", "error"] as const;

/** A query value that is one string, or nothing. */
const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * A member's Update your card (issue 145): the card on file, the card entry that replaces it, and, after a save, what
 * it did (`state` in the URL: `saved`, `retried` with the `rows` it paid, `declined`, `error`). A saved or retried state
 * has no form: the card is on file and only the back link is left. Only an active subscription reaches it; a cancelled
 * one is sent to account home.
 */
export default async function UpdateCard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { member, product, confirmation } = await requireSubscriber();
  if (confirmation.status === "cancelled") redirect(ACCOUNT_PATH);
  const query = await searchParams;
  const [t, language] = await Promise.all([getTranslator(), getLanguage()]);
  const repo = getRepository();
  const now = new Date();
  const { subscriptionId } = confirmation;

  const state = STATES.find((known) => known === one(query[ACCOUNT_CARD_STATE_PARAM]));
  const stored = await repo.findSubscriptionCard(subscriptionId);
  const cardWords = stored && t("account.card.ending", { last4: stored.last4 });

  // The rows the retry paid, as the page may name them: this subscription's own paid rows among the ids in the URL.
  const ids = (one(query[ACCOUNT_CARD_ROWS_PARAM]) ?? "").split(",").filter(Boolean);
  const paid = state === "retried" ? await repo.listPaidCharges(subscriptionId, ids) : [];
  const retried = state === "retried" && paid.length > 0 && cardWords !== null ? paid : null;

  let notice: { lead: string; text: string } | null = null;
  if (state === "saved" && cardWords) {
    // The next charge is the first open week whose cutoff has not passed, not `nextPickup`, which can name a week past its cutoff.
    const week = (await loadCalendar(repo, now)).weeks.find(
      (found) => found.closedAt === null && found.weekOf >= confirmation.pickupDate && !found.cutoffPassed,
    );
    if (week) {
      notice = {
        lead: t("account.card.saved"),
        text: t("account.card.savedNext", { day: formatPickupDate(cutoffDate(product, week.weekOf), language), card: cardWords }),
      };
    }
  } else if (retried && cardWords) {
    const weeks = await Promise.all(retried.map((row) => weekNamed(repo, product.id, row.pickupDate, language)));
    const total = formatUsdWhole(retried.reduce((sum, row) => sum + row.amountCents, 0));
    notice = {
      lead: t("account.card.saved"),
      text:
        weeks.length === 1
          ? t("account.card.retriedOne", { total, card: cardWords, week: weeks[0] ?? "" })
          : t("account.card.retriedMany", { total, card: cardWords, n: weeks.length, weeks: weeks.join(", ") }),
    };
  } else if (state === "declined") {
    notice = { lead: t("account.card.refusedLead"), text: t("account.card.refused") };
  }
  const done = notice !== null && (state === "saved" || state === "retried");

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
          {!done && (
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
