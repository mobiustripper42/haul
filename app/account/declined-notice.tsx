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

/** The Notice both cards draw (issue 254): an alert with a lead, a body line and the primary Update your card button. */
function cardNotice(t: Translator, lead: string, text: string): ReactElement {
  return (
    <Notice icon="alert" lead={lead}>
      {text}
      <span className="mt-3 block">
        <Button kind="primary" href={ACCOUNT_CARD_PATH}>
          {t("account.updateCard")}
        </Button>
      </span>
    </Notice>
  );
}

/**
 * Issue 198: the declined Notice account home and Upcoming weeks both draw, and whether the subscription holds a declined
 * row (`declined`, which drives account home's badge): an active subscription holding one (`lockedWeek`, issue 145). Its
 * week is named while its pickup is still to come (`next` is not null) and an admin has not closed it. Issue 254: an
 * active subscription with no card on file and no declined row (`needsCard`) draws the no-card Notice in the same slot.
 */
export async function declinedNotice(subscribed: Subscribed, next: AdminWeek | null, t: Translator, language: Language): Promise<{ declined: boolean; notice: ReactElement | null }> {
  const { product, confirmation } = subscribed;
  if (lockedWeek(confirmation) === null) {
    return { declined: false, notice: confirmation.needsCard ? cardNotice(t, t("account.card.noCardLead"), t("account.card.noCardBody")) : null };
  }
  const declinedRows = await getRepository().listDeclinedCharges(confirmation.subscriptionId);
  const declined = declinedRows.length > 0;
  const declinedWeek = next && declinedRows.find((row) => !row.closed);
  const declinedLine = declinedWeek && t("account.card.declinedWeek", { week: await weekNamed(getRepository(), product.id, declinedWeek.pickupDate, language) });
  const notice: ReactElement | null = declined
    ? cardNotice(t, t("account.card.declinedLead"), [t("account.card.declinedBody"), declinedLine].filter(Boolean).join(" "))
    : null;
  return { declined, notice };
}
