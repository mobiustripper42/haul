// Issue 63, AC4–AC6: the words paymentWording makes for the checkbox and for subscriptions.consent_text.
// That the page draws them is page.test.ts, and what the links do in a browser is e2e/supper-club.spec.ts.
// The Spanish catalog is replaced for this file by the two link words alone, so the links show they come from
// the translator it is handed, and the rest of the sentence falls back to English.
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@core/i18n.js";
import { formatUsdWhole } from "@core/money.js";
import { formatPickupDate } from "@core/pickup-week.js";
import { paymentWording } from "./payment-wording";

vi.mock("@core/messages/es.js", () => ({
  es: { "supperClub.consentTerms": "«terms»", "supperClub.consentPrivacy": "«privacy»" },
}));

const PRICE = formatUsdWhole(8550);

const wording = (language: "en" | "es" = "en") =>
  paymentWording(createTranslator(language), { priceCents: 8550, firstPickup: "2027-01-03", language });

describe("AC4 — the checkbox sentence", () => {
  it("AC4: it reads, in full, with the price in it", () => {
    expect(wording().sentence).toContain(PRICE);
  });
});

describe("AC5 — what subscriptions.consent_text stores", () => {
  it("AC5: it stores the two price lines, the pickup line and the sentence, joined by spaces", () => {
    const { consentText, pickupLine, sentence } = wording();
    expect(consentText.endsWith(` ${pickupLine} ${sentence}`)).toBe(true);
    expect(consentText.split(PRICE).length - 1).toBe(4);
    expect(pickupLine).toContain(formatPickupDate("2027-01-03", "en"));
  });
});

describe("AC6 — the sentence in pieces", () => {
  it("AC6: sentenceParts reads as the sentence, with Terms and Privacy Policy as links to their pages", () => {
    const { sentence, sentenceParts } = wording();
    expect(sentenceParts.map((part) => (typeof part === "string" ? part : part.text)).join("")).toBe(sentence);
    expect(sentenceParts.flatMap((part) => (typeof part === "string" ? [] : [part.href]))).toEqual(["/terms", "/privacy"]);
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
