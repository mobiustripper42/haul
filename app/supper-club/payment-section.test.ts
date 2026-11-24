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
import { en } from "@core/messages/en.js";
import { formatUsdWhole } from "@core/money.js";
import { alertTexts, attributesOf, screenMarkup, textsOf } from "../screen-test-helpers";
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
  cardLoading: t("supperClub.cardLoading"),
  todayLabel: t("supperClub.todayLabel"),
  weeklyLabel: t("supperClub.weeklyLabel"),
  consentError: t("supperClub.consentError"),
  declined: t("supperClub.payDeclined"),
  error: t("supperClub.payError"),
  // Read raw, not through `t`: the hint takes no value (issue 101, AC10), and the section shows what it is given.
  capHint: en["supperClub.capHint"],
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

/** The price panel's amounts: each row's value is the one bold run in the section. */
const panelAmounts = (html: string) => [...screenMarkup(html).matchAll(/<strong\b[^>]*>([^<]*)<\/strong>/g)].map((match) => match[1]);

/** The submit button's words. */
const payButton = (html: string) => /<button\b[^>]*type="submit"[^>]*>([^<]*)<\/button>/.exec(screenMarkup(html))?.[1] ?? "";

/** Where each marker first sits in the markup, so a test can say the elements come in that order. */
const positions = (html: string, markers: readonly string[]) => markers.map((marker) => screenMarkup(html).indexOf(marker));
const ascending = (at: number[]) => at.every((here, index) => here >= 0 && (index === 0 || here > (at[index - 1] ?? -1)));

const CHECKBOX = 'type="checkbox"';
const SUBMIT = 'type="submit"';
const CONSENT_ERROR = 'id="consent-error"';
const ALERT = 'role="alert"';

/** The markup inside the label that holds the checkbox. */
const consentLabel = (html: string) =>
  [...screenMarkup(html).matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map((label) => label[1] ?? "").find((label) => label.includes('type="checkbox"')) ?? "";

describe("AC1 — what the section shows", () => {
  it("AC1: it reads, in order, the legend, the card field, the price panel, the checkbox, the button and the hint", () => {
    const card = { testMode: true, applicationId: undefined, locationId: undefined, billing: { email: "ada@example.com" } };
    const html = render({ card });
    expect(ascending(positions(html, ['name="sourceId"', "<strong", CHECKBOX, SUBMIT]))).toBe(true);
    expect(panelAmounts(html)).toEqual([formatUsdWhole(5000), formatUsdWhole(5000)]);
    expect(payButton(html)).toContain(formatUsdWhole(5000));
  });

  it("AC1: the consent checkbox is named consent, and unticked", () => {
    const boxes = attributesOf(render(), "input").filter((input) => input.type === "checkbox");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.name).toBe("consent");
    expect(boxes[0]).not.toHaveProperty("checked");
  });

  it("AC1: the checkbox's sentence is its label", () => {
    expect(consentLabel(render()).replace(/<[^>]*>/g, "")).toContain(formatUsdWhole(5000));
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
    const html = render({ choices: { size: "four", menu: "standard" } });
    const sum = formatUsdWhole(8000);
    expect(panelAmounts(html)).toEqual([sum, sum]);
    expect(consentLabel(html).replace(/<[^>]*>/g, "")).toContain(sum);
    expect(payButton(html)).toContain(sum);
  });
});

describe("AC25 (issue 254) — the price panel's summary", () => {
  it("AC25: a summary stands in the price panel, above its amounts", () => {
    const html = render({ summary: "3–4 people · Vegan" });
    expect(ascending(positions(html, ["3–4 people · Vegan", "<strong"]))).toBe(true);
    expect(panelAmounts(html)).toEqual([formatUsdWhole(5000), formatUsdWhole(5000)]);
  });
});

describe("AC4, AC9, AC10a — what a failed pay shows", () => {
  it("AC4: ?payError=consent shows the field error after the checkbox, before the button, and no notice", () => {
    const html = render({ payError: "consent" });
    expect(ascending(positions(html, [CHECKBOX, CONSENT_ERROR, SUBMIT]))).toBe(true);
    expect(textsOf(html)).toContain(TEXT.consentError);
    expect(alertTexts(html)).toEqual([]);
  });

  // Declined and error share the alert icon, so which notice shows is told by its catalog line.
  it("AC9: ?payError=declined shows the notice above the button, and no field error", () => {
    const html = render({ payError: "declined" });
    expect(ascending(positions(html, [CHECKBOX, ALERT, SUBMIT]))).toBe(true);
    expect(alertTexts(html)).toEqual([TEXT.declined]);
    expect(screenMarkup(html)).not.toContain(CONSENT_ERROR);
  });

  it("AC10a: ?payError=error shows its notice above the button", () => {
    const html = render({ payError: "error" });
    expect(ascending(positions(html, [CHECKBOX, ALERT, SUBMIT]))).toBe(true);
    expect(alertTexts(html)).toEqual([TEXT.error]);
  });

  it("AC4: with no payError it shows no notice and no field error", () => {
    const html = render();
    expect(alertTexts(html)).toEqual([]);
    expect(screenMarkup(html)).not.toContain(CONSENT_ERROR);
  });
});
