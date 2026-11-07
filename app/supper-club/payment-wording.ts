import type { Language, Translator } from "@core/i18n.js";
import { PRIVACY_PATH, TERMS_PATH } from "@core/legal-documents.js";
import { formatUsdWhole } from "@core/money.js";
import { formatPickupDate } from "@core/pickup-week.js";

/** What a price comes to in words, for the price panel, the checkbox, the button and the stored consent. */
export type PaymentWording = {
  price: string;
  /** "First pickup: …. After that, your card is charged … until you cancel." */
  pickupLine: string;
  /** The checkbox's sentence, in plain words. */
  sentence: string;
  /** The same sentence in pieces: its words, and "Terms" and "Privacy Policy" as the links they are. */
  sentenceParts: (string | { href: string; text: string })[];
  /** "Join and pay $50". */
  button: string;
  /** What `subscriptions.consent_text` holds: the panel, the pickup line and the sentence, as shown. */
  consentText: string;
};

// Private-use characters, which no sentence holds, stand where a link goes while the sentence is cut.
const TERMS_MARK = "";
const PRIVACY_MARK = "";

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
  const terms = t("supperClub.consentTerms");
  const privacy = t("supperClub.consentPrivacy");
  const sentence = t("supperClub.consent", { price, terms, privacy });
  // The same sentence with a marker where each link goes, cut at the markers, so the pieces keep the order
  // the language gives them.
  const marked = t("supperClub.consent", { price, terms: TERMS_MARK, privacy: PRIVACY_MARK });
  const sentenceParts = marked
    .split(/([])/)
    .filter((piece) => piece !== "")
    .map((piece) =>
      piece === TERMS_MARK
        ? { href: TERMS_PATH, text: terms }
        : piece === PRIVACY_MARK
          ? { href: PRIVACY_PATH, text: privacy }
          : piece,
    );
  return {
    price,
    pickupLine,
    sentence,
    sentenceParts,
    button: t("supperClub.joinAndPay", { price }),
    consentText: [`${t("supperClub.todayLabel")}: ${price}.`, `${t("supperClub.weeklyLabel")}: ${price}.`, pickupLine, sentence].join(" "),
  };
}
