// Issue 63, AC4–AC6: the words paymentWording makes for the checkbox and for subscriptions.consent_text.
// That the page draws them is page.test.ts, and what the links do in a browser is e2e/supper-club.spec.ts.
// The Spanish catalog is replaced for this file by the two link words alone, so the links show they come from
// the translator it is handed, and the rest of the sentence falls back to English.
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@core/i18n.js";
import { paymentWording } from "./payment-wording";

vi.mock("@core/messages/es.js", () => ({
  es: { "supperClub.consentTerms": "«terms»", "supperClub.consentPrivacy": "«privacy»" },
}));

const SENTENCE = "I agree to a weekly charge of $85.50 until I cancel, and to the Terms and Privacy Policy. To cancel, sign in to your account before the end of Monday.";

const wording = (language: "en" | "es" = "en") =>
  paymentWording(createTranslator(language), { priceCents: 8550, firstPickup: "2027-01-03", language });

describe("AC4 — the checkbox sentence", () => {
  it("AC4: it reads, in full, with the price in it", () => {
    expect(wording().sentence).toBe(SENTENCE);
  });
});

describe("AC5 — what subscriptions.consent_text stores", () => {
  it("AC5: the whole sentence as shown, in plain words, within the panel and pickup line text", () => {
    expect(wording().consentText).toBe(
      "Today, for your first week: $85.50. Then every week, at the cutoff: $85.50. " +
        "First pickup: Sunday, January 3. After that, your card is charged $85.50 at the end of each Monday for the following week's pickup, until you cancel. " +
        SENTENCE,
    );
  });
});

describe("AC6 — the sentence in pieces", () => {
  it("AC6: sentenceParts is the sentence, with Terms and Privacy Policy as links to their pages", () => {
    expect(wording().sentenceParts).toEqual([
      "I agree to a weekly charge of $85.50 until I cancel, and to the ",
      { href: "/terms", text: "Terms" },
      " and ",
      { href: "/privacy", text: "Privacy Policy" },
      ". To cancel, sign in to your account before the end of Monday.",
    ]);
  });

  it("AC6: the links' words come from the catalog of the language it is handed", () => {
    expect(wording("es").sentenceParts).toEqual(
      expect.arrayContaining([
        { href: "/terms", text: "«terms»" },
        { href: "/privacy", text: "«privacy»" },
      ]),
    );
  });
});
