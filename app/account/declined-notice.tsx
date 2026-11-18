import type { ReactElement } from "react";
import { lockedWeek } from "@core/account-weeks.js";
import type { Language, Translator } from "@core/i18n.js";
import { weekNamed } from "@core/ledger-charge.js";
import type { AdminWeek } from "@core/pickup-week.js";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { ACCOUNT_CARD_PATH } from "../paths";
import { getRepository } from "../services";
import type { Subscribed } from "./subscriber";

/**
 * Issue 198: the declined Notice account home and Upcoming weeks both draw, and whether the subscription holds a declined
 * row (`declined`, which drives account home's badge): an active subscription holding one (`lockedWeek`, issue 145). Its
 * week is named while its pickup is still to come (`next` is not null) and an admin has not closed it.
 */
export async function declinedNotice(subscribed: Subscribed, next: AdminWeek | null, t: Translator, language: Language): Promise<{ declined: boolean; notice: ReactElement | null }> {
  const { product, confirmation } = subscribed;
  if (lockedWeek(confirmation) === null) return { declined: false, notice: null };
  const declinedRows = await getRepository().listDeclinedCharges(confirmation.subscriptionId);
  const declined = declinedRows.length > 0;
  const declinedWeek = next && declinedRows.find((row) => !row.closed);
  const declinedLine = declinedWeek && t("account.card.declinedWeek", { week: await weekNamed(getRepository(), product.id, declinedWeek.pickupDate, language) });
  const notice = declined && (
    <Notice icon="alert" lead={t("account.card.declinedLead")}>
      {[t("account.card.declinedBody"), declinedLine].filter(Boolean).join(" ")}
      <span className="mt-3 block">
        <Button kind="primary" href={ACCOUNT_CARD_PATH}>
          {t("account.updateCard")}
        </Button>
      </span>
    </Notice>
  );
  return { declined, notice: notice || null };
}
