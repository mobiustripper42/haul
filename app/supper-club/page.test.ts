// Issue 55, AC1–AC3 and AC14, issue 56 (the payment section's place, the retry state, the redirect of a member
// who already has a subscription) and issue 57 (the sold-out card's place): /supper-club,
// `await SupperClub(props)` rendered through react-dom/server with `next/headers` faked and the composition
// root handing out an InMemoryRepository. This file holds what the page decides and what it passes in: the
// pickers, the form and its target, which of the Join card, the retry state and the sold-out card shows, and
// what `PaymentSection` and `SoldOutCard` are given. Their own words are payment-section.test.ts and
// sold-out-card.test.ts; `OptionPicker`'s radios are components/ui/option-picker.test.ts; the frame around
// the page is join-page.test.ts; `resolveChoices`'s edge cases are src/choices.test.ts. A changed pick
// updating the words is a browser's, in e2e/supper-club.spec.ts.
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import type { PendingSignupInput } from "@core/ports/repository.js";
import type { ProductInput, ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Notice } from "../../components/ui/notice";
import { OptionPicker } from "../../components/ui/option-picker";
import { PricePanel } from "../../components/ui/price-panel";
import { Shell } from "../../components/ui/shell";
import { emptyRequest } from "../next-headers-fake";
import { findAll, inOrder, redirectOf, textsOf } from "../screen-test-helpers";
import { retrySupperClubPayment } from "./actions";
import SupperClub from "./page";
import { paymentWording } from "./payment-wording";
import { PaymentSection } from "./payment-section";
import { SoldOutCard } from "./sold-out-card";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
  farmEmail: undefined as string | undefined,
}));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({
  getRepository: () => services.repo,
  getSessionSecret: () => services.secret,
  isProduction: () => process.env.NODE_ENV === "production",
  getFarmContactEmail: () => services.farmEmail,
}));

const t = createTranslator("en");

const SIZE = {
  name: "Size",
  position: 1,
  options: [
    { name: "2 person", priceCents: 5000, position: 1 },
    { name: "3–4 person", priceCents: 8000, position: 2 },
  ],
};
const PREFERENCE = {
  name: "Preference",
  position: 2,
  options: [
    { name: "Standard", priceCents: 0, position: 1 },
    { name: "Vegan", priceCents: 0, position: 2 },
  ],
};
const SPICE = { name: "Spice", position: 3, options: [{ name: "Mild", priceCents: 0, position: 1 }] };
const productOf = (optionTypes: ProductInput["optionTypes"], cap = 50): ProductInput => ({
  name: "Supper Club",
  cap,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes,
});

// Friday 2026-11-06, 10:00 in Cleveland: before the first cutoff, whenever this suite runs.
const SIGNUP_DAY = new Date("2026-11-06T15:00:00.000Z");

let product: ProductWithOptions;

/** A fresh repository holding only this product. */
const stock = (optionTypes: ProductInput["optionTypes"], cap = 50) => {
  services.repo = new InMemoryRepository();
  product = services.repo.addProduct(productOf(optionTypes, cap));
};

// An id the product lacks reads as a string that matches nothing, so a test fails on what it asserts.
const typeId = (type: number) => product.optionTypes[type]?.id ?? "no such option type";
const optionId = (type: number, option: number) => product.optionTypes[type]?.options[option]?.id ?? "no such option";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: SIGNUP_DAY });
  request.current = emptyRequest();
  services.farmEmail = undefined;
  stock([SIZE, PREFERENCE]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const signIn = async (email = "ada@example.com") => {
  const member = await services.repo.createMember({ email });
  await services.repo.confirmMemberEmail(member.id, new Date());
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  request.current.cookies = { ocf_session: signSession({ subjectId: member.id, expiresAt }, services.secret) };
  return member;
};

const render = async (query: Record<string, string | string[] | undefined> = {}) => {
  const element = await SupperClub({ searchParams: Promise.resolve(query) });
  return { element, html: renderToStaticMarkup(element) };
};

type SectionProps = ComponentProps<typeof PaymentSection>;
const sectionOf = (element: ReactNode) => findAll(element, PaymentSection)[0]?.props as unknown as SectionProps | undefined;
const soldOutCardOf = (element: ReactNode) => findAll(element, SoldOutCard)[0]?.props as unknown as ComponentProps<typeof SoldOutCard> | undefined;
const pickersOf = (element: ReactNode) => findAll(element, OptionPicker).map((picker) => picker.props as unknown as ComponentProps<typeof OptionPicker>);
/** The page's own forms, inside the shell: the header's language switch and Sign out are SiteHeader's. */
const formsOf = (element: ReactNode) => findAll(findAll(element, Shell), "form");
const joinForm = (element: ReactNode) => formsOf(element).find((form) => form.props.method === "get");
const noticesOf = (element: ReactNode) => findAll(element, Notice).map((notice) => notice.props.children);

/** The words from the Join card's title on, so the left column's copy stays join-page.test.ts's. */
const inCard = (html: string, wanted: readonly string[]) => {
  const texts = textsOf(html);
  return texts.slice(texts.indexOf(t("supperClub.joinTitle"))).filter((text) => wanted.includes(text));
};

const legend = (n: number, name: string) => t("supperClub.pickerLegend", { n, name });
const accountLegend = (n: number) => t("supperClub.accountLegend", { n });

/** The rows a member's pending signup leaves: 3–4 person and Vegan, $80 a week. */
const rowsFor = (memberId: string): PendingSignupInput => ({
  memberId,
  productId: product.id,
  choices: { [typeId(0)]: optionId(0, 1), [typeId(1)]: optionId(1, 1) },
  firstChargeCents: 8000,
  weeklyCents: 8000,
  pickupDate: "2027-01-03",
  consentText: "I agree.",
  consentAt: SIGNUP_DAY,
});

/** A signup that charged and heard nothing: the ledger row pending, the card stored unless `card` is false. */
const stranded = async (over: { card?: boolean; declined?: boolean } = {}) => {
  const member = await signIn();
  const signup = await services.repo.savePendingSignup(rowsFor(member.id));
  if (over.card !== false) await services.repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1");
  if (over.declined) await services.repo.recordSignupDecline(signup.ledgerId);
  return signup;
};

/** Another member's pending rows with a card on them and the charge unanswered: a held spot. */
const holdASpot = async (email = "grace@example.com") => {
  const other = await services.repo.createMember({ email });
  const row = await services.repo.savePendingSignup(rowsFor(other.id));
  await services.repo.saveSubscriptionCard(row.subscriptionId, `ccof:${other.id}`);
};

describe("AC1 — one picker per option type, in stored order", () => {
  it('AC1: each picker\'s legend is "{n}. {option type name}", n counting from 1 in stored order', async () => {
    const { element } = await render();
    expect(pickersOf(element).map((picker) => picker.legend)).toEqual([legend(1, "Size"), legend(2, "Preference")]);
  });

  it("AC1: an option type added in data adds a picker, with no code change", async () => {
    stock([SIZE, PREFERENCE, SPICE]);
    const { element } = await render();
    expect(pickersOf(element).map((picker) => picker.legend)).toEqual([legend(1, "Size"), legend(2, "Preference"), legend(3, "Spice")]);
    expect(pickersOf(element)[2]?.options.map((option) => option.label)).toEqual(["Mild"]);
  });

  it.each([
    ["two option types", [SIZE, PREFERENCE], 3],
    ["three option types", [SIZE, PREFERENCE, SPICE], 4],
  ])('AC1: "Your account" is numbered one past the last type: %s', async (_what, types, n) => {
    stock(types);
    const { element, html } = await render();
    expect(findAll(element, "p").map((p) => p.props.children)).toContain(accountLegend(n));
    expect(inCard(html, [accountLegend(n - 1), accountLegend(n)])).toEqual([accountLegend(n)]);
  });

  it("AC1: an option is named for its option type's id, valued with its own id, and priced above $0 with its detail", async () => {
    const { element } = await render();
    expect(pickersOf(element).map((picker) => picker.name)).toEqual([typeId(0), typeId(1)]);
    expect(pickersOf(element)[0]?.options).toEqual([
      { value: optionId(0, 0), label: "2 person", detail: t("supperClub.price", { price: "$50" }) },
      { value: optionId(0, 1), label: "3–4 person", detail: t("supperClub.price", { price: "$80" }) },
    ]);
  });

  it("AC1: an option priced $0 has no detail", async () => {
    const { element } = await render();
    expect(pickersOf(element)[1]?.options).toEqual([
      { value: optionId(1, 0), label: "Standard" },
      { value: optionId(1, 1), label: "Vegan" },
    ]);
  });
});

describe("AC2 — signed out, the pickers and both buttons are one GET form", () => {
  it("AC2: the page holds one form, method get, to /supper-club/continue", async () => {
    const { element } = await render();
    expect(formsOf(element).map((form) => [form.props.method, form.props.action])).toEqual([["get", "/supper-club/continue"]]);
  });

  it("AC2: the right card reads, in order, its title, the pickers, the help line, section 3 and the two buttons", async () => {
    const order = [
      t("supperClub.joinTitle"),
      legend(1, "Size"),
      legend(2, "Preference"),
      t("supperClub.switchHelp"),
      accountLegend(3),
      t("supperClub.signedOutPrompt"),
      t("supperClub.createAccount"),
      t("home.signIn"),
    ];
    const { html } = await render();
    expect(inCard(html, order)).toEqual(order);
  });

  it("AC2: both buttons are submits named next, valued create-account and sign-in, Create an account primary and Sign in secondary", async () => {
    const { element } = await render();
    const buttons = findAll(joinForm(element), Button);
    expect(buttons.map(({ props }) => [props.children, props.kind, props.type, props.name, props.value])).toEqual([
      [t("supperClub.createAccount"), "primary", "submit", "next", "create-account"],
      [t("home.signIn"), "secondary", "submit", "next", "sign-in"],
    ]);
  });

  it("AC2: the pickers sit inside the form", async () => {
    const { element } = await render();
    expect(findAll(joinForm(element), OptionPicker)).toHaveLength(2);
  });

  it("AC2: a return path's choices are picked when the page loads", async () => {
    const { element } = await render({ [typeId(0)]: optionId(0, 1), [typeId(1)]: optionId(1, 1) });
    expect(pickersOf(element).map((picker) => picker.selected)).toEqual([optionId(0, 1), optionId(1, 1)]);
  });
});

describe("AC14 — a choice that is missing or not an option", () => {
  it("AC14: a choice that is not one of the type's options leaves the first picked, and the other type's choice stands", async () => {
    const { element } = await render({ [typeId(0)]: "not-an-option", [typeId(1)]: optionId(1, 1) });
    expect(pickersOf(element).map((picker) => picker.selected)).toEqual([optionId(0, 0), optionId(1, 1)]);
  });
});

describe("AC3 — signed in", () => {
  beforeEach(async () => {
    await signIn();
  });

  it('AC3: section 3 reads "Signed in as {email}." with its period, then section 4', async () => {
    const order = [accountLegend(3), t("supperClub.signedInAs", { email: "ada@example.com" }), t("supperClub.paymentLegend", { n: 4 })];
    const { html } = await render();
    expect(inCard(html, order)).toEqual(order);
  });

  it("AC3: the pickers stay, in a GET form to this page", async () => {
    const { element } = await render();
    expect(formsOf(element).map((form) => [form.props.method, form.props.action])).toContainEqual(["get", "/supper-club"]);
    expect(findAll(joinForm(element), OptionPicker)).toHaveLength(2);
  });
});

describe("issue 56 — the payment section", () => {
  it("AC1: a signed-out visitor does not get it", async () => {
    expect(sectionOf((await render()).element)).toBeUndefined();
  });

  it("AC1: signed in, it stands outside the pickers' GET form, so Enter on a radio can never pay", async () => {
    await signIn();
    const { element } = await render();
    expect(joinForm(element)).toBeDefined();
    expect(findAll(joinForm(element), PaymentSection)).toEqual([]);
    expect(findAll(element, PaymentSection)).toHaveLength(1);
  });

  it("AC1: its number is one past Your account's", async () => {
    stock([SIZE, PREFERENCE, SPICE]);
    await signIn();
    expect(sectionOf((await render()).element)?.text.legend).toBe(t("supperClub.paymentLegend", { n: 5 }));
  });

  it("AC2: it gets a wording for every price the picks can come to, made by paymentWording", async () => {
    await signIn();
    const wordings: SectionProps["wordings"] = sectionOf((await render()).element)?.wordings ?? {};
    expect(Object.keys(wordings).sort()).toEqual(["5000", "8000"]);
    expect(wordings["8000"]).toEqual(paymentWording(t, { priceCents: 8000, firstPickup: "2027-01-03", language: "en" }));
  });

  it("AC2: it gets the picks in the query", async () => {
    await signIn();
    const { element } = await render({ [typeId(0)]: optionId(0, 1), [typeId(1)]: optionId(1, 1) });
    expect(sectionOf(element)?.choices).toEqual({ [typeId(0)]: optionId(0, 1), [typeId(1)]: optionId(1, 1) });
  });

  it("AC3: at Monday's cutoff (24:00), Cleveland time, the first pickup it is given is January 10", async () => {
    vi.setSystemTime(new Date("2026-12-29T05:00:00.000Z"));
    await signIn();
    expect(sectionOf((await render()).element)?.wordings["5000"]?.pickupLine).toBe(
      t("supperClub.pickupLine", { date: "Sunday, January 10", price: "$50" }),
    );
  });

  it.each(["consent", "declined", "error"])("AC4, AC9, AC10a: ?payError=%s reaches it", async (payError) => {
    await signIn();
    expect(sectionOf((await render({ payError })).element)?.payError).toBe(payError);
  });

  it.each(["unknown", "soldout"])("AC10: ?payError=%s on the normal form is not passed on: the URL alone shows nothing", async (payError) => {
    await signIn();
    expect(sectionOf((await render({ payError })).element)?.payError).toBeUndefined();
  });

  it.each([
    ["on the e2e server", "1", "test", true],
    ["anywhere else", "", "test", false],
    ["in production, even with E2E set", "1", "production", false],
  ])("AC1: CardEntry's test field is on %s: %s", async (_where, e2e, nodeEnv, testMode) => {
    vi.stubEnv("E2E", e2e);
    vi.stubEnv("NODE_ENV", nodeEnv);
    await signIn();
    expect(sectionOf((await render()).element)?.card.testMode).toBe(testMode);
  });
});

describe("AC5 — a member who already has a subscription", () => {
  const paidUp = async (cap = 50) => {
    stock([SIZE, PREFERENCE], cap);
    const member = await signIn();
    const { ledgerId, amountCents } = await services.repo.savePendingSignup(rowsFor(member.id));
    await services.repo.confirmSignupRows(ledgerId, "PAYMENT_1", amountCents, SIGNUP_DAY);
  };

  it("AC5: opening the page redirects to /supper-club/already", async () => {
    await paidUp();
    expect(await redirectOf(render())).toBe("/supper-club/already");
  });

  it("AC5: straight after a code, with picks in the query, the picks are discarded", async () => {
    await paidUp();
    expect(await redirectOf(render({ [typeId(0)]: optionId(0, 1) }))).toBe("/supper-club/already");
  });

  it("AC5: viewing writes no event", async () => {
    await paidUp();
    await redirectOf(render());
    expect(services.repo.events()).toEqual([]);
  });

  it("AC4 (issue 57): at the cap they still go to the already page", async () => {
    await paidUp(1);
    expect(await redirectOf(render())).toBe("/supper-club/already");
  });
});

describe("AC10 — the retry state", () => {
  it("AC10: a pending row with a card shows the notice, the box and amount from the row, and Try again, in order, with no query", async () => {
    await stranded();
    const { element, html } = await render();
    const order = [
      t("supperClub.signedInAs", { email: "ada@example.com" }),
      t("supperClub.retryNotice"),
      "3–4 person · Vegan",
      t("supperClub.todayLabel"),
      "$80",
      t("supperClub.tryAgain"),
    ];
    expect(inOrder(html, order)).toEqual(order);
    expect(findAll(element, PricePanel).map((panel) => [panel.props.summary, panel.props.rows])).toEqual([
      ["3–4 person · Vegan", [{ label: t("supperClub.todayLabel"), value: "$80" }]],
    ]);
  });

  it("AC10: it replaces the pickers and the payment section", async () => {
    await stranded();
    const { element } = await render();
    expect(pickersOf(element)).toEqual([]);
    expect(sectionOf(element)).toBeUndefined();
    expect(joinForm(element)).toBeUndefined();
  });

  it('AC10: "Try again" is the primary button of a form posting to retrySupperClubPayment', async () => {
    await stranded();
    const { element } = await render();
    const tryAgain = findAll(element, Button).find((button) => button.props.children === t("supperClub.tryAgain"));
    expect(tryAgain?.props).toMatchObject({ kind: "primary", type: "submit" });
    expect(formsOf(element).map((form) => form.props.action)).toEqual([retrySupperClubPayment]);
  });

  it("AC10: it shows when they come back later with other picks in the query: the row decides, not the URL", async () => {
    await stranded();
    const { element } = await render({ [typeId(0)]: optionId(0, 0) });
    expect(noticesOf(element)).toEqual([t("supperClub.retryNotice")]);
    expect(findAll(element, PricePanel)[0]?.props.rows).toEqual([{ label: t("supperClub.todayLabel"), value: "$80" }]);
  });

  it('AC10: when "Try again" comes back error, the error notice shows above the price panel, and only then', async () => {
    await stranded();
    const { element, html } = await render({ payError: "error" });
    expect(noticesOf(element)).toEqual([t("supperClub.retryNotice"), t("supperClub.payError")]);
    const order = [t("supperClub.payError"), "3–4 person · Vegan"];
    expect(inOrder(html, order)).toEqual(order);
    expect(noticesOf((await render()).element)).toEqual([t("supperClub.retryNotice")]);
  });

  it.each([
    ["?payError=unknown with no pending row", async () => signIn(), { payError: "unknown" }],
    ["a pending row with no card, so a failed saveCard never shows it", async () => stranded({ card: false }), {}],
    ["a declined row, even with its card still stored", async () => stranded({ declined: true }), {}],
  ])("AC10: %s is the normal form", async (_what, setUp, query) => {
    await setUp();
    const { element } = await render(query);
    expect(sectionOf(element)).toBeDefined();
    expect(noticesOf(element)).toEqual([]);
  });
});

describe("issue 57 — the sold-out card", () => {
  const soldOut = async () => {
    stock([SIZE, PREFERENCE], 1);
    await holdASpot();
  };

  describe("AC3 — at the cap the card stands in place of the form", () => {
    it("AC3: a visitor sees the card, and no form, picker or Join card", async () => {
      await soldOut();
      const { element, html } = await render();
      expect(findAll(element, SoldOutCard)).toHaveLength(1);
      expect(pickersOf(element)).toEqual([]);
      expect(formsOf(element)).toEqual([]);
      expect(textsOf(html)).not.toContain(t("supperClub.joinTitle"));
    });

    it("AC3: a signed-in member who holds no spot sees the card, and no payment section", async () => {
      await soldOut();
      await signIn();
      const { element } = await render();
      expect(findAll(element, SoldOutCard)).toHaveLength(1);
      expect(sectionOf(element)).toBeUndefined();
    });

    it.each([
      ["with no card", false],
      ["declined", true],
    ])("AC3: a member whose own pending row is %s holds no spot, and sees the card", async (_what, declined) => {
      await soldOut();
      const member = await signIn();
      const row = await services.repo.savePendingSignup(rowsFor(member.id));
      if (declined) await services.repo.recordSignupDecline(row.ledgerId);
      expect(findAll((await render()).element, SoldOutCard)).toHaveLength(1);
    });

    it("AC3: one spot short of the cap the form stands, which the card replaces", async () => {
      stock([SIZE, PREFERENCE], 2);
      await holdASpot();
      const { element } = await render();
      expect(findAll(element, SoldOutCard)).toEqual([]);
      expect(pickersOf(element)).toHaveLength(2);
    });
  });

  describe("AC4 — a member the cap does not stop", () => {
    it('AC4: a member with a stranded payment still sees "Try again" at the cap, and no sold-out card', async () => {
      stock([SIZE, PREFERENCE], 1);
      await stranded();
      const { element, html } = await render();
      expect(textsOf(html)).toEqual(expect.arrayContaining([t("supperClub.retryNotice"), t("supperClub.tryAgain")]));
      expect(findAll(element, SoldOutCard)).toEqual([]);
    });
  });

  describe("AC5 — the state comes from the count, never the URL", () => {
    it("AC5: payError=soldout with spots open is the normal form for a visitor, with no notice", async () => {
      const { element } = await render({ payError: "soldout" });
      expect(findAll(element, SoldOutCard)).toEqual([]);
      expect(pickersOf(element)).toHaveLength(2);
      expect(noticesOf(element)).toEqual([]);
    });

    it('AC5: payError=soldout on a stranded payment is "Try again", with no sold-out card', async () => {
      stock([SIZE, PREFERENCE], 1);
      await stranded();
      const { element } = await render({ payError: "soldout" });
      expect(findAll(element, SoldOutCard)).toEqual([]);
      expect(noticesOf(element)).toEqual([t("supperClub.retryNotice")]);
    });
  });

  describe("AC9, AC15, AC16 — what the card is given", () => {
    it("AC9: payError=soldout at the cap gives the card its notice", async () => {
      await soldOut();
      expect(soldOutCardOf((await render({ payError: "soldout" })).element)?.notice).toBe(true);
    });

    it("AC9: the notice shows on payError=soldout alone: another payError gives the card none", async () => {
      await soldOut();
      expect(soldOutCardOf((await render({ payError: "declined" })).element)?.notice).toBe(false);
    });

    it("AC16: the farm's email, when set, is what the card is given; unset it is given none", async () => {
      await soldOut();
      expect(soldOutCardOf((await render()).element)?.email).toBeUndefined();
      services.farmEmail = "farm@ohiocityfarm.com";
      expect(soldOutCardOf((await render()).element)?.email).toBe("farm@ohiocityfarm.com");
    });
  });
});

describe("AC17 — the page's cards fill their columns", () => {
  it('AC17: the Join card uses width="fill"', async () => {
    const { element } = await render();
    const joinCards = findAll(element, Card).filter((card) => textsOf(renderToStaticMarkup(card)).includes(t("supperClub.joinTitle")));
    expect(joinCards.map((card) => card.props.width)).toEqual(["fill"]);
  });
});

describe("issue 77 — the page opens on JoinPage's frame", () => {
  it("AC3: it stays on the page shell, not the pane's", async () => {
    expect(findAll((await render()).element, Shell).map((shell) => shell.props.width)).toEqual(["page"]);
  });
});

// Issue 101, AC7: the pickers ask with a question mark that is the catalog's (`supperClub.pickerLegend`),
// over option types stored without one (DEC-027).
describe("AC7 (issue 101) — the pickers' legends ask", () => {
  it('AC7: option types stored as "How many people" and "Which menu" read "1. How many people?" and "2. Which menu?"', async () => {
    stock([
      { ...SIZE, name: "How many people" },
      { ...PREFERENCE, name: "Which menu" },
    ]);
    const { element } = await render();
    expect(pickersOf(element).map((picker) => picker.legend)).toEqual(["1. How many people?", "2. Which menu?"]);
  });
});

// Issue 101, AC10: the payment section's hint advertises no cap.
describe("AC10 (issue 101) — the payment section's hint", () => {
  it('AC10: it is "Limited supply of subscriptions. No sales tax.", whatever the cap', async () => {
    stock([SIZE, PREFERENCE], 30);
    await signIn();
    expect(sectionOf((await render()).element)?.text.capHint).toBe("Limited supply of subscriptions. No sales tax.");
  });
});

// Issue 101, AC9: step 3 names a member who has a name, in the normal and the retry state. Which name is
// `memberDisplayName`'s (src/members.test.ts); a member with none still reads "Signed in as {email}." (AC3, AC10 above).
describe("AC9 (issue 101) — step 3 names the member", () => {
  const PAULA = "paid@example.com";
  const SIGNED_IN_AS_PAULA = "Signed in as Paula Paid, paid@example.com.";

  const signInPaula = async () => {
    const member = await services.repo.saveAccount({ email: PAULA, firstName: "Paula", lastName: "Paid", phone: "216-555-0105", language: "en" });
    await services.repo.confirmMemberEmail(member.id, new Date());
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    request.current.cookies = { ocf_session: signSession({ subjectId: member.id, expiresAt }, services.secret) };
    return member;
  };

  it('AC9: in the normal state, section 3 reads "Signed in as Paula Paid, paid@example.com.", then section 4', async () => {
    await signInPaula();
    const order = [accountLegend(3), SIGNED_IN_AS_PAULA, t("supperClub.paymentLegend", { n: 4 })];
    expect(inCard((await render()).html, order)).toEqual(order);
  });

  it("AC9: in the retry state it reads the same line, before the notice", async () => {
    const member = await signInPaula();
    const signup = await services.repo.savePendingSignup(rowsFor(member.id));
    await services.repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1");
    const order = [accountLegend(3), SIGNED_IN_AS_PAULA, t("supperClub.retryNotice")];
    expect(inOrder((await render()).html, order)).toEqual(order);
  });
});
