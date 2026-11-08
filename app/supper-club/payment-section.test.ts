// Issue 56, AC1, AC2, AC4, AC9 and AC10a, and issue 63, AC4 and AC6: PaymentSection, section 4 of the Join
// card. It owns the order of its words, the consent checkbox and its sentence and links, the hidden picks,
// the price following the pick and where each failed-pay message sits; that the page gives it the right
// props, and keeps it out of the pickers' GET form, is app/supper-club/page.test.ts's. `paymentWording` is
// real here, so a wording is what the page would hand over. Pay itself (the token, the action) is a browser's.
// The section is a client component, so it is read through its markup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@core/i18n.js";
import { alertTexts, attributesOf, inOrder, screenMarkup, textsOf } from "../screen-test-helpers";
import { paymentWording } from "./payment-wording";
import { PaymentSection, type PaymentText } from "./payment-section";

vi.mock("./actions", () => ({ joinSupperClub: async () => {} }));

const t = createTranslator("en");
const wordingFor = (priceCents: number) => paymentWording(t, { priceCents, firstPickup: "2027-01-03", language: "en" });

const TEXT: PaymentText = {
  legend: t("supperClub.paymentLegend", { n: 4 }),
  cardLabel: t("supperClub.cardLabel"),
  cardHint: t("supperClub.cardHint"),
  testCard: t("supperClub.testCard"),
  cardFailed: t("supperClub.cardFailed"),
  cardRefused: t("supperClub.cardRefused"),
  todayLabel: t("supperClub.todayLabel"),
  weeklyLabel: t("supperClub.weeklyLabel"),
  consentError: t("supperClub.consentError"),
  declined: t("supperClub.payDeclined"),
  error: t("supperClub.payError"),
  capHint: t("supperClub.capHint", { cap: 50 }),
};

const PRICES = [
  { typeId: "size", options: [{ id: "two", priceCents: 5000 }, { id: "four", priceCents: 8000 }] },
  { typeId: "menu", options: [{ id: "standard", priceCents: 0 }, { id: "vegan", priceCents: 0 }] },
];

const render = (over: Partial<Parameters<typeof PaymentSection>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PaymentSection, {
      prices: PRICES,
      choices: { size: "two", menu: "standard" },
      wordings: { "5000": wordingFor(5000), "8000": wordingFor(8000) },
      payError: undefined,
      text: TEXT,
      card: { testMode: false, applicationId: undefined, locationId: undefined, billing: { email: "ada@example.com" } },
      ...over,
    }),
  );

/** The words with the links in the checkbox sentence read as part of its one run of text. */
const words = (html: string) => textsOf(html.replace(/<\/?a\b[^>]*>/g, ""));

/** The markup inside the label that holds the checkbox. */
const consentLabel = (html: string) =>
  [...screenMarkup(html).matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map((label) => label[1] ?? "").find((label) => label.includes('type="checkbox"')) ?? "";

describe("AC1 — what the section shows", () => {
  it("AC1: it reads, in order, the legend, the card field, the price panel, the checkbox, the button and the hint", () => {
    const wording = wordingFor(5000);
    expect(words(render())).toEqual([
      TEXT.legend,
      TEXT.cardLabel,
      TEXT.cardHint,
      TEXT.todayLabel,
      wording.price,
      TEXT.weeklyLabel,
      wording.price,
      wording.pickupLine,
      wording.sentence,
      wording.button,
      TEXT.capHint,
    ]);
  });

  it("AC1: the consent checkbox is named consent, and unticked", () => {
    const boxes = attributesOf(render(), "input").filter((input) => input.type === "checkbox");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.name).toBe("consent");
    expect(boxes[0]).not.toHaveProperty("checked");
  });

  it("AC1: the checkbox's sentence is its label", () => {
    expect(consentLabel(render()).replace(/<[^>]*>/g, "")).toBe(wordingFor(5000).sentence);
  });

  it("AC1: it is one form of its own, holding no picker, so Enter on a radio can never pay", () => {
    const html = render();
    expect(attributesOf(html, "form")).toHaveLength(1);
    expect(attributesOf(html, "input").filter((input) => input.type === "radio")).toEqual([]);
  });

  it("AC1: it carries the picks in hidden fields named by option type id", () => {
    const hidden = attributesOf(render({ choices: { size: "four", menu: "vegan" } }), "input").filter((input) => input.type === "hidden");
    expect(hidden.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: "size", value: "four" },
      { name: "menu", value: "vegan" },
    ]);
  });
});

describe("AC4, AC6 (issue 63) — the checkbox sentence", () => {
  it('AC6: "Terms" and "Privacy Policy" are the label\'s two links, to /terms and /privacy', () => {
    const label = consentLabel(render());
    expect([...label.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map((link) => link[1])).toEqual([t("supperClub.consentTerms"), t("supperClub.consentPrivacy")]);
    expect(attributesOf(label, "a").map((link) => link.href)).toEqual(["/terms", "/privacy"]);
  });

  it("AC6: each opens in a new tab", () => {
    const links = attributesOf(consentLabel(render()), "a");
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
  });
});

describe("AC2 — the price follows the pick", () => {
  it("AC2: the panel, the sentence and the button all carry the sum of the picks", () => {
    const wording = wordingFor(8000);
    expect(words(render({ choices: { size: "four", menu: "standard" } }))).toEqual(
      expect.arrayContaining([wording.pickupLine, wording.sentence, wording.button]),
    );
  });
});

describe("AC4, AC9, AC10a — what a failed pay shows", () => {
  const sentence = wordingFor(5000).sentence;
  const button = wordingFor(5000).button;

  it("AC4: ?payError=consent shows the field error after the checkbox, before the button, and no notice", () => {
    const html = render({ payError: "consent" });
    const order = [sentence, TEXT.consentError, button];
    expect(inOrder(html.replace(/<\/?a\b[^>]*>/g, ""), order)).toEqual(order);
    expect(alertTexts(html)).toEqual([]);
  });

  it("AC9: ?payError=declined shows the notice above the button, and no field error", () => {
    const html = render({ payError: "declined" });
    const order = [sentence, TEXT.declined, button];
    expect(inOrder(html.replace(/<\/?a\b[^>]*>/g, ""), order)).toEqual(order);
    expect(alertTexts(html)).toEqual([TEXT.declined]);
    expect(textsOf(html)).not.toContain(TEXT.consentError);
  });

  it("AC10a: ?payError=error shows its notice above the button", () => {
    const html = render({ payError: "error" });
    const order = [sentence, TEXT.error, button];
    expect(inOrder(html.replace(/<\/?a\b[^>]*>/g, ""), order)).toEqual(order);
    expect(alertTexts(html)).toEqual([TEXT.error]);
  });

  it("AC4: with no payError it shows no notice and no field error", () => {
    const html = render();
    expect(alertTexts(html)).toEqual([]);
    expect(textsOf(html)).not.toContain(TEXT.consentError);
  });
});
