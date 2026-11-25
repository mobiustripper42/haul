// Issue 145: Update your card, `await UpdateCard(props)` with `next/headers` faked and the composition root mocked, as
// app/account/cancel/page.test.ts renders the cancel confirm. Who is let in is requireAccount's
// (app/account/subscriber.test.ts). What a save does is src/update-card.test.ts's; which paid row the page may name is
// findPaidCharge's, and which row has a charge out is findPendingCharge's (src/adapters/charge-run-contract.ts): the page
// maps the outcome in the URL to its message, and the data to the form or none, so each state goes through it once, with the
// Notice it picks and the values in it (issue 211), never its words. The form is a client component; the page is read
// for what it hands it, as app/supper-club/page.test.ts reads PaymentSection.
import type { ComponentProps, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { en } from "@core/messages/en.js";
import { formatUsdWhole } from "@core/money.js";
import { formatPickupDate, pickupWeek, weekTitle } from "@core/pickup-week.js";
import type { Card } from "@core/ports/payments.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { Notice } from "../../../components/ui/notice";
import { alertTexts, attributesOf, findAll, sentencesOf, textsOf } from "../../screen-test-helpers";
import { SiteHeader } from "../../site-header";
import { CardForm } from "./card-form";
import UpdateCard from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../services", () => ({
  getRepository: () => services.repo,
  getPayments: () => {
    throw new Error("/account/card has no reason to reach Square while it renders");
  },
  getEmail: () => {
    throw new Error("/account/card has no reason to send email while it renders");
  },
  getSessionSecret: () => services.secret,
  getSiteUrl: () => "https://members.example.test",
  isProduction: () => process.env.NODE_ENV === "production",
}));
vi.mock("../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));
// `retryCard` is the Try again that issue 254 removed: kept here so a page that still drew it would be seen.
vi.mock("./actions", () => ({
  saveCard: Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: "$ACTION_ID_saveCard", action: "saveCard" }) }),
  retryCard: Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: "$ACTION_ID_retryCard", action: "retryCard" }) }),
}));

// Wednesday, February 3, 2027, noon in Cleveland. February 7's cutoff, the end of Monday, February 1, has passed and its
// pickup is to come; the first week whose cutoff is still ahead is February 14's, at the end of Monday, February 8.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const FEB_7 = "2027-02-07";
const JAN_17 = "2027-01-17";
const JAN_24 = "2027-01-24";
const JAN_31 = "2027-01-31";

/** The card on file before a save. */
const OLD_CARD: Card = { id: "ccof:old-card", brand: "MASTERCARD", last4: "4444", expMonth: 1, expYear: 2029 };
/** The card a save put on file. */
const NEW_CARD: Card = { id: "ccof:new-card", brand: "VISA", last4: "1111", expMonth: 12, expYear: 2030 };

const t = createTranslator("en");

let product: ProductWithOptions;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  product = addSupperClub(services.repo);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const signIn = (member: Member): void => {
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(Date.now() + DAY).toISOString() }, services.secret);
};

/**
 * Ada, signed in, with an active subscription paid for January 3 at $45 a week, `card` on file from the signup (none when
 * null). Her member and the subscription's id.
 */
const subscribedAda = async (card: Card | null = OLD_CARD): Promise<{ member: Member; subscriptionId: string }> => {
  const member = await services.repo.saveAccount({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "(216) 555-0134", language: "en" });
  const rows = await services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 4500,
    weeklyCents: 4500,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $45.",
    consentAt: new Date("2026-12-01T17:00:00.000Z"),
  });
  await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"), card ?? undefined);
  signIn(member);
  return { member, subscriptionId: rows.subscriptionId };
};

const render = async (query: Record<string, string | string[] | undefined> = {}) => {
  const element = await UpdateCard({ searchParams: Promise.resolve(query) });
  const html = renderToStaticMarkup(element);
  // The page has no badge, so a line in a <span> beside another reads through as one sentence.
  return { element, html, sentences: sentencesOf(html, ["span"]) };
};

type FormProps = ComponentProps<typeof CardForm>;
const cardFormOf = (element: ReactNode) => findAll(element, CardForm)[0]?.props as unknown as FormProps | undefined;

/** Where each link on the page goes. */
const hrefsOf = (html: string): string[] => attributesOf(html, "a").map((link) => link.href ?? "");
const noticeIcons = (element: ReactNode) => findAll(element, Notice).map((notice) => notice.props.icon);

const titleOf = (weekOf: string): string => weekTitle(t, pickupWeek(weekOf, null), "en");

/**
 * The weekly run's row, not settled, on Ada's subscription: her member linked to a Square customer, as every active one is,
 * and a pending row for February 7, as a charge-run row whose answer was lost leaves it. Its id.
 */
const runsRow = async (member: Member, subscriptionId: string): Promise<string> => {
  await services.repo.setMemberSquareCustomer(member.id, "CUSTOMER_ADA");
  return services.repo.addLedgerRow(subscriptionId, FEB_7, "pending", 4500);
};

/** The submits of the form posting to `action`, by their attributes; none when no form posts to it. */
const submitsTo = (html: string, action: string): string[] =>
  [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].flatMap(([, attrs = "", inner = ""]) => {
    const buttons = attributesOf(inner, "button");
    const posts = buttons.find((button) => button.formaction !== undefined)?.formaction ?? attributesOf(`<form${attrs}>`, "form")[0]?.action;
    if (posts !== action) return [];
    return [...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
      .filter(([, a = ""]) => attributesOf(`<button${a}>`, "button")[0]?.type === "submit")
      .map(([, a = ""]) => a);
  });

/** The On file now line's words before the card, read from the catalog: the line is shown in some states, not others. */
const ON_FILE_OPENS = en["account.card.onFile"].split("{card}")[0] ?? "no such line";

// Issue 219, AC8: the card page is reached from Your account, so the header marks it; which link that is, is
// app/site-header.test.ts's.
describe("AC8 (issue 219) — the header on /account/card", () => {
  it('AC8: the page opens with the site header, Your account marked current: current "account"', async () => {
    await subscribedAda();
    vi.mocked(SiteHeader).mockClear();
    await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "account" }));
  });
});

describe("AC2 — who reaches /account/card, and what it shows", () => {
  // Issue 260: a member with no active subscription stays here. What the Notice is is noSupperClubNotice's
  // (../no-supper-club-notice.test.ts), so here it is which one, by its lead's catalog line, and where its button goes.
  /** The page drawn with `query` sends nobody anywhere and holds the back link, then the heading, then the one Notice with `lead` and its link to /supper-club, and no card, card-on-file line or form. Its markup. */
  const expectNoticePage = async (query: Parameters<typeof render>[0], lead: string): Promise<string> => {
    await expect(UpdateCard({ searchParams: Promise.resolve(query ?? {}) })).resolves.toBeDefined();
    const { element, html, sentences } = await render(query);
    expect(findAll(element, Notice).map(({ props }) => props.lead)).toEqual([lead]);
    expect(hrefsOf(html)).toEqual(["/account", "/supper-club"]);
    const at = ['href="/account"', "<h1", 'role="alert"', 'href="/supper-club"'].map((mark) => html.indexOf(mark));
    expect(at.every((n, i) => n >= 0 && (i === 0 || n > (at[i - 1] ?? -1)))).toBe(true);
    expect(html).not.toMatch(/<section\b|<form\b|<button\b/);
    expect(sentences.some((sentence) => sentence.startsWith(ON_FILE_OPENS))).toBe(false);
    expect(cardFormOf(element)).toBeUndefined();
    return html;
  };
  /** The page's one h1's words. */
  const headingOf = (html: string): string => [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(([, inner = ""]) => textsOf(inner).join(" ")).join(" | ");

  it("AC8 (issue 260): a cancelled member gets the back link to /account, the heading an active member sees, and the cancelled Notice; no card on file, no card form", async () => {
    const { subscriptionId } = await subscribedAda();
    const heading = headingOf((await render()).html);
    await services.repo.cancelSubscription(subscriptionId, NOW);
    vi.mocked(SiteHeader).mockClear();
    expect(headingOf(await expectNoticePage({}, t("account.cancelledNotice")))).toBe(heading);
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "account" }));
  });

  it("AC8 (issue 260): whatever the query says, and whatever row the cancelled subscription holds, the page is the same", async () => {
    const { member, subscriptionId } = await subscribedAda();
    const paid = await services.repo.addLedgerRow(subscriptionId, JAN_24, "paid", 4500);
    await services.repo.addLedgerRow(subscriptionId, JAN_31, "declined", 4500);
    await runsRow(member, subscriptionId);
    await services.repo.cancelSubscription(subscriptionId, NOW);
    const html = await expectNoticePage({}, t("account.cancelledNotice"));
    for (const query of [{ state: "saved" }, { state: "paid", row: paid }, { state: "paidNoCard", row: paid }, { state: "declined" }, { state: "unknown" }, { state: "error" }]) {
      expect(await expectNoticePage(query, t("account.cancelledNotice"))).toBe(html);
    }
  });

  it("AC2: in order, the back link to /account, the heading, and the card's last four; no Notice", async () => {
    await subscribedAda();
    const { html } = await render();
    const at = ['href="/account"', "<h1", "4444"].map((mark) => html.indexOf(mark));
    expect(at.every((n, i) => n >= 0 && (i === 0 || n > (at[i - 1] ?? -1)))).toBe(true);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(alertTexts(html)).toEqual([]);
  });

  it("AC8 (issue 260): a member who never joined gets the back link to /account, the heading and the never-joined Notice, whatever the query says; no card form", async () => {
    signIn(await services.repo.saveAccount({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "(216) 555-0134", language: "en" }));
    for (const query of [{}, { state: "saved" }, { state: "error" }, { state: "unknown" }]) await expectNoticePage(query, t("account.noSupperClub"));
  });

  it("AC2: with no card's brand stored, the On file now line is left out; the rest of the page stays", async () => {
    await subscribedAda(null);
    const { element, sentences } = await render();
    expect(sentences.some((sentence) => sentence.startsWith(ON_FILE_OPENS))).toBe(false);
    expect(cardFormOf(element)).toBeDefined();
  });

  it("with no declined rows, the card entry's amount is the subscription's weekly price", async () => {
    await subscribedAda();
    expect(cardFormOf((await render()).element)?.amountCents).toBe(4500);
  });

  it("with declined rows, it is the total of those a save would charge: a closed week's is left out", async () => {
    const { subscriptionId } = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, JAN_17, "declined", 4500);
    await services.repo.addLedgerRow(subscriptionId, JAN_24, "declined", 4500);
    await services.repo.addLedgerRow(subscriptionId, JAN_31, "declined", 8000);
    await services.repo.closePickupWeek(product.id, JAN_17, null, new Date("2027-01-10T15:00:00.000Z"));
    expect(cardFormOf((await render()).element)?.amountCents).toBe(12500);
  });

  it.each([
    ["on the e2e server", "1", true],
    ["anywhere else", "", false],
  ])("the card entry's test field is gated as the signup's: %s it is %s, and billing is the member's", async (_where, e2e, testMode) => {
    vi.stubEnv("E2E", e2e);
    vi.stubEnv("NODE_ENV", "test");
    await subscribedAda();
    expect(cardFormOf((await render()).element)?.card).toMatchObject({
      testMode,
      billing: { email: "ada@example.com", givenName: "Ada", familyName: "Lovelace" },
    });
  });
});

describe("AC3 — state saved", () => {
  it("AC3: a check Notice names when the next charge is and the card now on file, and the form is gone", async () => {
    await subscribedAda(NEW_CARD);
    const { element, html } = await render({ state: "saved" });
    expect(noticeIcons(element)).toEqual(["check"]);
    expect(alertTexts(html)[0]).toContain(formatPickupDate("2027-02-08", "en"));
    expect(alertTexts(html)[0]).toContain("1111");
    expect(cardFormOf(element)).toBeUndefined();
    expect(hrefsOf(html)).toContain("/account");
  });

});

// Issue 202: the next charge's week is loadNextPickup's, with cutoffAhead; which week that is, skips and the stop after
// lockedOn included, is nextPickup's and weeksFrom's (src/pickup-week.test.ts). Here one skipped week, and the locked
// case, go through the page.
describe("AC3, AC4 (issue 202) — state saved, the member's next week", () => {
  it("AC3 (issue 202): with February 14 skipped, the Notice names the cutoff of February 21, at the end of Monday, February 15", async () => {
    const { subscriptionId } = await subscribedAda(NEW_CARD);
    await services.repo.skipWeek(subscriptionId, "2027-02-14");
    const { html } = await render({ state: "saved" });
    expect(alertTexts(html)).toHaveLength(1);
    expect(alertTexts(html)[0]).toContain(formatPickupDate("2027-02-15", "en"));
    expect(alertTexts(html)[0]).toContain("1111");
  });

  // A real save pays the declined row or leaves its charge out (src/ports/repository.ts), so this state is reached only by its URL.
  it("AC4 (issue 202): locked, a declined row for February 7, whose cutoff has passed: the Notice is Card saved. alone, and the form is gone", async () => {
    const { subscriptionId } = await subscribedAda(NEW_CARD);
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "declined", 4500);
    const { element, html } = await render({ state: "saved" });
    expect(alertTexts(html)).toEqual([t("account.card.saved")]);
    expect(noticeIcons(element)).toEqual(["check"]);
    expect(cardFormOf(element)).toBeUndefined();
  });
});

describe("AC4 — state declined", () => {
  it("AC4: an alert Notice shows; the card on file is still named and the form is still shown", async () => {
    await subscribedAda();
    const { element, html, sentences } = await render({ state: "declined" });
    expect(noticeIcons(element)).toEqual(["alert"]);
    expect(alertTexts(html)).toEqual([`${t("account.card.refusedLead")} ${t("account.card.refused")}`]);
    expect(sentences.some((sentence) => sentence.includes("4444"))).toBe(true);
    expect(cardFormOf(element)).toBeDefined();
  });
});

describe("AC6 — state paid", () => {
  it("AC6: with the row the week paid, the Notice names its amount, the card now on file and the week; the form is gone", async () => {
    const { subscriptionId } = await subscribedAda(NEW_CARD);
    const paid = await services.repo.addLedgerRow(subscriptionId, JAN_31, "paid", 4500);
    const { element, html } = await render({ state: "paid", row: paid });
    expect(noticeIcons(element)).toEqual(["check"]);
    for (const value of [formatUsdWhole(4500), "1111", titleOf(JAN_31)]) expect(alertTexts(html)[0]).toContain(value);
    expect(cardFormOf(element)).toBeUndefined();
    expect(hrefsOf(html)).toContain("/account");
  });

  it.each([
    ["a row that is not the subscription's paid row", true],
    ["no row", false],
  ])("a paid state with %s is ignored: no Notice, and the form shows", async (_what, withRow) => {
    const { subscriptionId } = await subscribedAda(NEW_CARD);
    const declined = await services.repo.addLedgerRow(subscriptionId, JAN_24, "declined", 4500);
    const { element, html } = await render(withRow ? { state: "paid", row: declined } : { state: "paid" });
    expect(alertTexts(html)).toEqual([]);
    expect(cardFormOf(element)).toBeDefined();
  });
});

describe("AC10 (issue 254) — state paidNoCard", () => {
  it("AC10: with the row the week paid, an alert Notice names its amount and the week, and the card form stays", async () => {
    const { subscriptionId } = await subscribedAda(null);
    const paid = await services.repo.addLedgerRow(subscriptionId, JAN_31, "paid", 4500);
    const { element, html } = await render({ state: "paidNoCard", row: paid });
    expect(noticeIcons(element)).toEqual(["alert"]);
    for (const value of [formatUsdWhole(4500), titleOf(JAN_31)]) expect(alertTexts(html)[0]).toContain(value);
    expect(cardFormOf(element)).toBeDefined();
  });

  it("AC10: with no card on file, the On file now line is left out and the form stays", async () => {
    const { subscriptionId } = await subscribedAda(null);
    const paid = await services.repo.addLedgerRow(subscriptionId, JAN_31, "paid", 4500);
    const { element, sentences } = await render({ state: "paidNoCard", row: paid });
    expect(sentences.some((sentence) => sentence.startsWith(ON_FILE_OPENS))).toBe(false);
    expect(cardFormOf(element)).toBeDefined();
  });

  it.each([
    ["a row that is not the subscription's paid row", true],
    ["no row", false],
  ])("AC10: a paidNoCard state with %s is ignored: no Notice, and the form shows", async (_what, withRow) => {
    const { subscriptionId } = await subscribedAda();
    const declined = await services.repo.addLedgerRow(subscriptionId, JAN_24, "declined", 4500);
    const { element, html } = await render(withRow ? { state: "paidNoCard", row: declined } : { state: "paidNoCard" });
    expect(alertTexts(html)).toEqual([]);
    expect(cardFormOf(element)).toBeDefined();
  });
});

// What the card box sends Square needs Square's script in a browser (AC18, by hand); the page's part is that it picks none.
describe("AC14 (issue 254) — one card box on every page", () => {
  it.each([
    ["nothing owed", false],
    ["a declined week owed", true],
  ])("AC14: with %s the form is handed no intent of its own", async (_what, owed) => {
    const { subscriptionId } = await subscribedAda();
    if (owed) await services.repo.addLedgerRow(subscriptionId, JAN_24, "declined", 4500);
    const form = cardFormOf((await render()).element);
    expect(form).toBeDefined();
    expect(form).not.toHaveProperty("intent");
  });
});

describe("AC8, AC10, AC11, AC26 (issue 254) — a charge out, the weekly run's row, and an error", () => {
  /** Ada's declined row for `week`, its card update's charge out with no answer; it stays declined. Its id. */
  const chargeOut = async (member: Member, subscriptionId: string, { week = JAN_24, cents = 4500 }: { week?: string; cents?: number } = {}): Promise<string> => {
    await services.repo.setMemberSquareCustomer(member.id, "CUSTOMER_ADA");
    const ledgerId = await services.repo.addLedgerRow(subscriptionId, week, "declined", cents);
    expect((await services.repo.claimCardUpdate(subscriptionId, NOW)).kind).toBe("claimed");
    return ledgerId;
  };

  it("AC8, AC26: while the subscription, a card on file, holds the weekly run's pending row, whatever the URL says, the page shows the confirming Notice, and no card form and no Try again", async () => {
    const { member, subscriptionId } = await subscribedAda();
    await runsRow(member, subscriptionId);
    for (const query of [{}, { state: "unknown" }, { state: "saved" }]) {
      const { element, html } = await render(query);
      expect(alertTexts(html)).toContain(t("account.card.confirming"));
      expect(submitsTo(html, "retryCard")).toEqual([]);
      expect(cardFormOf(element)).toBeUndefined();
    }
    const { element, html } = await render();
    expect(noticeIcons(element)).toEqual(["alert"]);
    expect(alertTexts(html)).toEqual([t("account.card.confirming")]);
  });

  it("AC26: with no card on file, the weekly run's pending row is no reason to refuse one: the card form, and no Notice", async () => {
    const { member, subscriptionId } = await subscribedAda(null);
    await runsRow(member, subscriptionId);
    const { element, html } = await render();
    expect(alertTexts(html)).toEqual([]);
    expect(cardFormOf(element)).toBeDefined();
  });

  it("AC20, AC26 (issue 254): while a card update's charge is out on a declined week, the week still declined, the page shows the retry Notice and the card form, and no Try again", async () => {
    const { member, subscriptionId } = await subscribedAda();
    const week = await chargeOut(member, subscriptionId);
    expect((await services.repo.listDeclinedCharges(subscriptionId)).map((row) => row.ledgerId)).toEqual([week]);
    const { element, html } = await render();
    expect(noticeIcons(element)).toEqual(["alert"]);
    expect(alertTexts(html)).toEqual([t("supperClub.retryNotice")]);
    expect(submitsTo(html, "retryCard")).toEqual([]);
    expect(cardFormOf(element)).toBeDefined();
  });

  it("AC26: a charge out comes before the weekly run's pending row: the retry Notice and the card form", async () => {
    const { member, subscriptionId } = await subscribedAda();
    await chargeOut(member, subscriptionId);
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "pending", 4500);
    const { element, html } = await render();
    expect(alertTexts(html)).toEqual([t("supperClub.retryNotice")]);
    expect(cardFormOf(element)).toBeDefined();
  });

  it.each(["saved", "paid"])("AC26: state %s while a charge is out keeps the card form, with the retry Notice", async (state) => {
    const { member, subscriptionId } = await subscribedAda(NEW_CARD);
    const paid = await services.repo.addLedgerRow(subscriptionId, JAN_31, "paid", 4500);
    await chargeOut(member, subscriptionId);
    const { element, html } = await render({ state, row: paid });
    expect(alertTexts(html)).toContain(t("supperClub.retryNotice"));
    expect(cardFormOf(element)).toBeDefined();
  });

  it("AC26: while a charge is out the card entry's amount is that row's, not the total of the weeks declined", async () => {
    const { member, subscriptionId } = await subscribedAda();
    await chargeOut(member, subscriptionId, { week: JAN_24, cents: 8000 });
    await services.repo.addLedgerRow(subscriptionId, JAN_31, "declined", 4500);
    expect(cardFormOf((await render()).element)?.amountCents).toBe(8000);
  });

  it("AC26: the row whose charge is out gives the amount though its week has closed since", async () => {
    const { member, subscriptionId } = await subscribedAda();
    await chargeOut(member, subscriptionId, { week: JAN_24, cents: 8000 });
    await services.repo.closePickupWeek(product.id, JAN_24, null, NOW);
    const { element } = await render();
    expect(cardFormOf(element)?.amountCents).toBe(8000);
  });

  it("AC26: state unknown with no pending row shows the retry Notice and the card form, and no Try again", async () => {
    await subscribedAda();
    const { element, html } = await render({ state: "unknown" });
    expect(noticeIcons(element)).toEqual(["alert"]);
    expect(alertTexts(html)).toEqual([t("supperClub.retryNotice")]);
    expect(submitsTo(html, "retryCard")).toEqual([]);
    expect(cardFormOf(element)).toBeDefined();
  });

  it("AC11: state error with no pending row shows the signup's payError Notice above the card form", async () => {
    await subscribedAda();
    const { element, html } = await render({ state: "error" });
    expect(noticeIcons(element)).toEqual(["alert"]);
    expect(alertTexts(html)).toEqual([t("supperClub.payError")]);
    expect(cardFormOf(element)).toBeDefined();
  });

  it("AC11, AC26: state error while the weekly run's row is pending shows the payError Notice, then the confirming Notice, and no card form and no Try again", async () => {
    const { member, subscriptionId } = await subscribedAda();
    await runsRow(member, subscriptionId);
    const { element, html } = await render({ state: "error" });
    expect(noticeIcons(element)).toEqual(["alert", "alert"]);
    expect(alertTexts(html)).toEqual([t("supperClub.payError"), t("account.card.confirming")]);
    expect(submitsTo(html, "retryCard")).toEqual([]);
    expect(cardFormOf(element)).toBeUndefined();
  });

  it("AC26: state error while a charge is out shows the retry Notice alone, and the card form", async () => {
    const { member, subscriptionId } = await subscribedAda();
    await chargeOut(member, subscriptionId);
    const { element, html } = await render({ state: "error" });
    expect(alertTexts(html)).toEqual([t("supperClub.retryNotice")]);
    expect(cardFormOf(element)).toBeDefined();
  });
});
