// Issue 63, AC4–AC6: the words paymentWording makes for the checkbox and for subscriptions.consent_text.
// That the page draws them is page.test.ts, and what the links do in a browser is e2e/supper-club.spec.ts.
// The Spanish catalog is replaced for this file by the two link words alone, so the links show they come from
// the translator it is handed, and the rest of the sentence falls back to English.
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@core/i18n.js";
import { en } from "@core/messages/en.js";
import { paymentWording } from "./payment-wording";

vi.mock("@core/messages/es.js", () => ({
  es: { "supperClub.consentTerms": "«terms»", "supperClub.consentPrivacy": "«privacy»" },
}));

// AC4's criterion is the sentence itself, so its words are typed here, once; AC5 and AC6 build on it.
const SENTENCE ="I agree to a weekly charge of $85.50 until I cancel, and to the Terms and Privacy Policy. To cancel, sign in to your account before the end of Monday.";

const wording = (language: "en" | "es" = "en") =>
  paymentWording(createTranslator(language), { priceCents: 8550, firstPickup: "2027-01-03", language });

describe("AC4 — the checkbox sentence", () => {
  it("AC4: it reads, in full, with the price in it", () => {
    expect(wording().sentence).toBe(SENTENCE);
  });
});

describe("AC5 — what subscriptions.consent_text stores", () => {
  it("AC5: the whole sentence as shown, in plain words, within the panel and pickup line text", () => {
    const t = createTranslator("en");
    expect(wording().consentText).toBe(
      [
        `${en["supperClub.todayLabel"]}: $85.50.`,
        `${en["supperClub.weeklyLabel"]}: $85.50.`,
        t("supperClub.pickupLine", { date: "Sunday, January 3", price: "$85.50" }),
        SENTENCE,
      ].join(" "),
    );
  });
});

describe("AC6 — the sentence in pieces", () => {
  it("AC6: sentenceParts reads as the sentence, with Terms and Privacy Policy as links to their pages", () => {
    const { sentence, sentenceParts } = wording();
    expect(sentenceParts.map((part) => (typeof part === "string" ? part : part.text)).join("")).toBe(sentence);
    expect(sentenceParts.filter((part) => typeof part !== "string")).toEqual([
      { href: "/terms", text: en["supperClub.consentTerms"] },
      { href: "/privacy", text: en["supperClub.consentPrivacy"] },
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
