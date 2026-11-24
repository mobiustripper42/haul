// Issue 55, AC1–AC3 and AC14, issue 56 (the payment section's place, a charge that is out, the redirect of a member
// who already has a subscription) and issue 57 (the sold-out card's place): /supper-club,
// `await SupperClub(props)` rendered through react-dom/server with `next/headers` faked and the composition
// root handing out an InMemoryRepository. This file holds what the page decides and what it passes in: the
// pickers, the form and its target, which of the Join card, the card form over a charge that is out and the sold-out card shows, and
// what `PaymentSection` and `SoldOutCard` are given. Their own words are payment-section.test.ts and
// sold-out-card.test.ts; `OptionPicker`'s radios are components/ui/option-picker.test.ts; the frame around
// the page is join-page.test.ts; `resolveChoices`'s edge cases are src/choices.test.ts. A changed pick
// updating the words is a browser's, in e2e/supper-club.spec.ts.
import { type ComponentProps, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import { formatPickupDate } from "@core/pickup-week.js";
import type { PendingSignupInput } from "@core/ports/repository.js";
import type { ProductInput, ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Notice } from "../../components/ui/notice";
import { OptionPicker } from "../../components/ui/option-picker";
import { Shell } from "../../components/ui/shell";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, attributesOf, findAll, redirectOf } from "../screen-test-helpers";
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

/** Every element in the tree, in document order (the walk findAll makes). */
const elementsOf = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child as ReactNode));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elementsOf(node.props.children as ReactNode)];
};
/** Where each match first stands in the tree's document order, -1 where none does. */
const positionsOf = (element: ReactNode, matches: ReadonlyArray<(el: ReactElement<Record<string, unknown>>) => boolean>) => {
  const all = elementsOf(element);
  return matches.map((match) => all.findIndex(match));
};
const lineReading = (text: string) => (el: ReactElement<Record<string, unknown>>) => el.type === "p" && el.props.children === text;
const ofType = (type: unknown) => (el: ReactElement<Record<string, unknown>>) => el.type === type;
/** Expects every position found, each after the one before. */
const expectInOrder = (positions: number[]) => {
  expect(positions.every((at) => at > -1)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
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

/** A signup that charged and heard nothing: the ledger row pending, its charge out unless `out` is false. */
const stranded = async (over: { out?: boolean; declined?: boolean } = {}) => {
  const member = await signIn();
  const signup = await services.repo.savePendingSignup(rowsFor(member.id));
  if (over.out !== false) await services.repo.startSignupCharge(signup.subscriptionId, SIGNUP_DAY);
  if (over.declined) await services.repo.recordSignupDecline(signup.ledgerId);
  return signup;
};

/** Another member's pending rows with a charge out, unanswered: a held spot. */
const holdASpot = async (email = "grace@example.com") => {
  const other = await services.repo.createMember({ email });
  const row = await services.repo.savePendingSignup(rowsFor(other.id));
  await services.repo.startSignupCharge(row.subscriptionId, SIGNUP_DAY);
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
    const { element } = await render();
    expect(findAll(element, "p").map((p) => p.props.children)).toContain(accountLegend(n));
    expect(findAll(element, "p").map((p) => p.props.children)).not.toContain(accountLegend(n - 1));
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

  it("AC2: both buttons are submits named next, valued create-account and sign-in, Create an account primary and Sign in secondary", async () => {
    const { element } = await render();
    const buttons = findAll(joinForm(element), Button);
    expect(buttons.map(({ props }) => [props.kind, props.type, props.name, props.value])).toEqual([
      ["primary", "submit", "next", "create-account"],
      ["secondary", "submit", "next", "sign-in"],
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

  // A member with no name is the email line of the two signedInText picks between; the named line is AC9 (issue 101).
  it('AC3: section 3 reads "Signed in as {email}." with its period, then section 4', async () => {
    const { element } = await render();
    expectInOrder(positionsOf(element, [lineReading(t("supperClub.signedInAs", { email: "ada@example.com" })), ofType(PaymentSection)]));
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
    expect(sectionOf((await render()).element)?.wordings["5000"]?.pickupLine).toContain(formatPickupDate("2027-01-10", "en"));
  });

  // Issue 133: the edges of a closed or moved week are src/pickup-week.test.ts's; these hold that the page reads them.
  it("AC1 (issue 133): with January 3 closed, the first pickup it is given is January 10", async () => {
    await services.repo.savePickupWeek(product.id, {
      weekOf: "2027-01-03",
      closedAt: new Date("2026-11-01T12:00:00.000Z"),
      note: "Farm closed",
      firstDay: null,
      lastDay: null,
    });
    await signIn();
    expect(sectionOf((await render()).element)?.wordings["5000"]?.pickupLine).toContain(formatPickupDate("2027-01-10", "en"));
  });

  it("AC3 (issue 133): with January 3 moved to Saturday and Sunday, the first pickup it names is Saturday, January 2", async () => {
    await services.repo.savePickupWeek(product.id, { weekOf: "2027-01-03", closedAt: null, note: "Moved", firstDay: "2027-01-02", lastDay: "2027-01-03" });
    await signIn();
    expect(sectionOf((await render()).element)?.wordings["5000"]?.pickupLine).toContain(formatPickupDate("2027-01-02", "en"));
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

describe("AC25 (issue 254) — a charge that is out", () => {
  const ROW_PICKS = () => ({ [typeId(0)]: optionId(0, 1), [typeId(1)]: optionId(1, 1) });

  it("AC25: a pending row whose charge is out shows the notice, then the card form with the row's picks and their names as its summary, in order, with no query", async () => {
    await stranded();
    const { element } = await render();
    expect(noticesOf(element)).toEqual([t("supperClub.retryNotice")]);
    expectInOrder(positionsOf(element, [ofType(Notice), ofType(PaymentSection)]));
    expect(sectionOf(element)).toMatchObject({ choices: ROW_PICKS(), summary: "3–4 person · Vegan" });
    expect(sectionOf(element)?.wordings["8000"]?.price).toBe("$80");
  });

  it("AC25: it replaces the pickers, whose GET form is gone with them; the card form stays", async () => {
    await stranded();
    const { element } = await render();
    expect(pickersOf(element)).toEqual([]);
    expect(joinForm(element)).toBeUndefined();
    expect(sectionOf(element)).toBeDefined();
  });

  it("AC25: there is no Try again button: the page has no form or button of its own, and Pay is the card form's", async () => {
    await stranded();
    const { element, html } = await render();
    expect(formsOf(element)).toEqual([]);
    expect(findAll(findAll(element, Card), Button)).toEqual([]);
    const join = /<section\b[^>]*>([\s\S]*)<\/section>/.exec(html)?.[1] ?? "";
    expect(attributesOf(join, "button").filter((button) => button.type === "submit")).toHaveLength(1);
  });

  it("AC25: it shows when they come back later with other picks in the query: the row decides, not the URL", async () => {
    await stranded();
    const { element } = await render({ [typeId(0)]: optionId(0, 0) });
    expect(noticesOf(element)).toEqual([t("supperClub.retryNotice")]);
    expect(sectionOf(element)).toMatchObject({ choices: ROW_PICKS(), summary: "3–4 person · Vegan" });
  });

  it("AC25: payError=error is not drawn while the charge is out, though another payError still is", async () => {
    await stranded();
    const { html } = await render({ payError: "error" });
    expect(alertTexts(html)).toEqual([t("supperClub.retryNotice")]);
    expect(sectionOf((await render({ payError: "consent" })).element)?.payError).toBe("consent");
  });

  it("AC25: its words name the row's pickup week, though the cutoff for it has passed", async () => {
    vi.setSystemTime(new Date("2026-12-29T05:00:00.000Z"));
    await stranded();
    const words = sectionOf((await render()).element)?.wordings["8000"];
    expect(words).toEqual(paymentWording(t, { priceCents: 8000, firstPickup: "2027-01-03", language: "en" }));
  });

  it("AC25: a row's week moved to Saturday and Sunday is named by its Saturday, January 2", async () => {
    await stranded();
    await services.repo.savePickupWeek(product.id, { weekOf: "2027-01-03", closedAt: null, note: "Moved", firstDay: "2027-01-02", lastDay: "2027-01-03" });
    const words = sectionOf((await render()).element)?.wordings["8000"];
    expect(words).toEqual(paymentWording(t, { priceCents: 8000, firstPickup: "2027-01-02", language: "en" }));
  });

  it.each([
    ["a pending row with no charge out, as a refused charge leaves it", async () => stranded({ out: false })],
    ["a declined row", async () => stranded({ declined: true })],
  ])("AC10: %s is the normal form", async (_what, setUp) => {
    await setUp();
    const { element } = await render();
    expect(sectionOf(element)).toBeDefined();
    expect(pickersOf(element)).toHaveLength(2);
    expect(noticesOf(element)).toEqual([]);
  });

  it("AC26: ?payError=unknown with no pending row is the normal form, with the retry notice", async () => {
    await signIn();
    const { element, html } = await render({ payError: "unknown" });
    expect(sectionOf(element)).toBeDefined();
    expect(pickersOf(element)).toHaveLength(2);
    expect(alertTexts(html)).toEqual([t("supperClub.retryNotice")]);
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
      const { element } = await render();
      expect(findAll(element, SoldOutCard)).toHaveLength(1);
      expect(pickersOf(element)).toEqual([]);
      expect(formsOf(element)).toEqual([]);
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
    it("AC4: a member with a stranded payment still sees the card form at the cap, and no sold-out card", async () => {
      stock([SIZE, PREFERENCE], 1);
      await stranded();
      const { element } = await render();
      expect(noticesOf(element)).toEqual([t("supperClub.retryNotice")]);
      expect(sectionOf(element)).toBeDefined();
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

    it("AC5: payError=soldout on a stranded payment is the card form, with no sold-out card", async () => {
      stock([SIZE, PREFERENCE], 1);
      await stranded();
      const { element } = await render({ payError: "soldout" });
      expect(findAll(element, SoldOutCard)).toEqual([]);
      expect(noticesOf(element)).toEqual([t("supperClub.retryNotice")]);
      expect(sectionOf(element)).toBeDefined();
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
    const joinCards = findAll(element, Card).filter((card) => findAll(card, OptionPicker).length > 0);
    expect(joinCards.map((card) => card.props.width)).toEqual(["fill"]);
  });
});

describe("issue 77 — the page opens on JoinPage's frame", () => {
  it("AC3: it stays on the page shell, not the pane's", async () => {
    expect(findAll((await render()).element, Shell).map((shell) => shell.props.width)).toEqual(["page"]);
  });
});

// Issue 101, AC9: step 3 names a member who has a name, in the normal state and over a charge that is out. Which name is
// `memberDisplayName`'s (src/members.test.ts); a member with none still reads "Signed in as {email}." (AC3 above).
describe("AC9 (issue 101) — step 3 names the member", () => {
  const PAULA = "paid@example.com";
  const SIGNED_IN_AS_PAULA = t("supperClub.signedInAsNamed", { name: "Paula Paid", email: PAULA });

  const signInPaula = async () => {
    const member = await services.repo.saveAccount({ email: PAULA, firstName: "Paula", lastName: "Paid", phone: "216-555-0105", language: "en" });
    await services.repo.confirmMemberEmail(member.id, new Date());
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    request.current.cookies = { ocf_session: signSession({ subjectId: member.id, expiresAt }, services.secret) };
    return member;
  };

  it('AC9: in the normal state, section 3 reads "Signed in as Paula Paid, paid@example.com.", then section 4', async () => {
    await signInPaula();
    const { element } = await render();
    expectInOrder(positionsOf(element, [lineReading(SIGNED_IN_AS_PAULA), ofType(PaymentSection)]));
  });

  it("AC9: over a charge that is out it reads the same line, before the notice", async () => {
    const member = await signInPaula();
    const signup = await services.repo.savePendingSignup(rowsFor(member.id));
    await services.repo.startSignupCharge(signup.subscriptionId, SIGNUP_DAY);
    const { element } = await render();
    expect(noticesOf(element)).toEqual([t("supperClub.retryNotice")]);
    expectInOrder(positionsOf(element, [lineReading(SIGNED_IN_AS_PAULA), ofType(Notice)]));
  });
});
