import type { Language, Translator } from "@core/i18n.js";
import { formatUsdWhole } from "@core/money.js";
import { formatPickupDate } from "@core/pickup-week.js";

/** What a price comes to in words, for the price panel, the checkbox, the button and the stored consent. */
export type PaymentWording = {
  price: string;
  /** "First pickup: …. After that, your card is charged … until you cancel." */
  pickupLine: string;
  /** The checkbox's sentence. */
  sentence: string;
  /** "Join and pay $50". */
  button: string;
  /** What `subscriptions.consent_text` holds: the panel, the pickup line and the sentence, as shown. */
  consentText: string;
};

/**
 * The one home for the words the price panel, the checkbox, the button and `consent_text` share, so the
 * text shown and the text stored cannot differ. The page calls it for each price a pick can come to; the
 * action calls it for the price it charges, and stores the result (docs/SPEC.md §7.12).
 */
export function paymentWording(
  t: Translator,
  input: { priceCents: number; firstPickup: string; language: Language },
): PaymentWording {
  const price = formatUsdWhole(input.priceCents);
  const pickupLine = t("supperClub.pickupLine", { date: formatPickupDate(input.firstPickup, input.language), price });
  const sentence = t("supperClub.consent", { price });
  return {
    price,
    pickupLine,
    sentence,
    button: t("supperClub.joinAndPay", { price }),
    consentText: [`${t("supperClub.todayLabel")}: ${price}.`, `${t("supperClub.weeklyLabel")}: ${price}.`, pickupLine, sentence].join(" "),
  };
}
