// Issue 254, AC14: the two client forms that draw the card box and the intent each hands it. CardEntry itself is Square's
// script in a browser, so it is a stand-in here that records its props; what an intent sends Square is cardDetails'
// (components/ui/card-entry.test.ts), and which one the card page picks is app/account/card/page.test.ts's.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CardEntry } from "../components/ui/card-entry";
import { CardForm } from "./account/card/card-form";
import { PaymentSection, type PaymentText } from "./supper-club/payment-section";

vi.mock("../components/ui/card-entry", () => ({ CardEntry: vi.fn(() => null) }));
vi.mock("./account/card/actions", () => ({ saveCard: async () => {} }));
vi.mock("./supper-club/actions", () => ({ joinSupperClub: async () => {} }));

const card = { testMode: false, applicationId: undefined, locationId: undefined, billing: { email: "ada@example.com" } };

/** The intent of each card box drawn. */
const intents = () => vi.mocked(CardEntry).mock.calls.map(([props]) => props.intent);

beforeEach(() => {
  vi.mocked(CardEntry).mockClear();
});

describe("AC14 (issue 254) — the intent each form gives the card box", () => {
  it.each(["STORE", "CHARGE_AND_STORE"] as const)("AC14: CardForm hands its intent on: %s", (intent) => {
    const text = { cardLabel: "Card", cardHint: "Hint", testCard: "Test card", cardFailed: "Failed", cardRefused: "Refused", cardLoading: "Loading", save: "Save" };
    renderToStaticMarkup(createElement(CardForm, { intent, amountCents: 5000, card, text }));
    expect(intents()).toEqual([intent]);
  });

  it("AC14: the signup's payment section charges and stores", () => {
    const text: PaymentText = {
      legend: "Payment",
      cardLabel: "Card",
      cardHint: "Hint",
      testCard: "Test card",
      cardFailed: "Failed",
      cardRefused: "Refused",
      cardLoading: "Loading",
      todayLabel: "Today",
      weeklyLabel: "Weekly",
      consentError: "Consent",
      declined: "Declined",
      error: "Error",
      capHint: "Cap",
    };
    const wording = { price: "$50", pickupLine: "Pickup", sentenceParts: ["I agree."], button: "Pay" } as never;
    renderToStaticMarkup(
      createElement(PaymentSection, {
        prices: [{ typeId: "size", options: [{ id: "two", priceCents: 5000 }] }],
        choices: { size: "two" },
        wordings: { "5000": wording },
        payError: undefined,
        text,
        card,
      }),
    );
    expect(intents()).toEqual(["CHARGE_AND_STORE"]);
  });
});
