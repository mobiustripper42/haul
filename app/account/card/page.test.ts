// Issue 145: Update your card, `await UpdateCard(props)` with `next/headers` faked and the composition root mocked, as
// app/account/cancel/page.test.ts renders the cancel confirm. Who is let in is requireSubscriber's
// (app/account/subscriber.test.ts). What a save does is src/update-card.test.ts's, and which rows the page may name is
// listPaidCharges' (src/adapters/charge-run-contract.ts): the page maps the outcome in the URL to its message, so each
// state goes through it once, with the page's own wording (the total, the weeks, one week or several). The form is a
// client component; the page is read for what it hands it, as app/supper-club/page.test.ts reads PaymentSection. The
// page's words are new copy, typed once here; "Your meal" and the card entry's own words are existing copy, read from
// the catalog.
import type { ComponentProps, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { en } from "@core/messages/en.js";
import { pickupWeek, weekTitle } from "@core/pickup-week.js";
import type { Card } from "@core/ports/payments.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { alertTexts, attributesOf, findAll, redirectOf, sentencesOf, textsOf } from "../../screen-test-helpers";
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
vi.mock("./actions", () => ({
  saveCard: Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: "$ACTION_ID_saveCard", action: "saveCard" }) }),
}));

// Wednesday, February 3, 2027, noon in Cleveland. February 7's cutoff, the end of Monday, February 1, has passed and its
// pickup is to come; the first week whose cutoff is still ahead is February 14's, at the end of Monday, February 8.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;
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
 * Ada, signed in, with an active subscription paid for January 3 at $45 a week, `card` bound at the signup (none when
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
  if (card) await services.repo.saveSubscriptionCard(rows.subscriptionId, card);
  await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
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

/** Each link on the page: where it goes, and its text. */
const linksOf = (html: string): { href: string; text: string }[] =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    href: attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "",
    text: textsOf(inner).join(" "),
  }));

const titleOf = (weekOf: string): string => weekTitle(t, pickupWeek(weekOf, null), "en");

const HEADING = "Update your card";
const ON_FILE_OLD = "On file now: card ending 4444. The new card replaces it for every charge from now on.";
const DECLINED = "That card was declined. Nothing was charged and your old card stays on file. Check the details or try another card.";

describe("AC2 — who reaches /account/card, and what it shows", () => {
  it("AC2: a member whose subscription is cancelled is sent to /account", async () => {
    const { subscriptionId } = await subscribedAda();
    await services.repo.cancelSubscription(subscriptionId, NOW);
    await expect(redirectOf(UpdateCard({ searchParams: Promise.resolve({}) }))).resolves.toBe("/account");
  });

  it("AC2: in order, the back link Your meal, the heading, and On file now with the card's last four; no Notice", async () => {
    await subscribedAda();
    const { html, sentences } = await render();
    const wanted = [en["header.yourMeal"], HEADING, ON_FILE_OLD];
    expect(sentences.filter((sentence) => wanted.includes(sentence))).toEqual(wanted);
    expect(linksOf(html)).toContainEqual({ href: "/account", text: en["header.yourMeal"] });
    expect(alertTexts(html)).toEqual([]);
  });

  it("AC2: with no card's brand stored, the On file now line is left out; the rest of the page stays", async () => {
    await subscribedAda(null);
    const { element, sentences } = await render();
    expect(sentences).toContain(HEADING);
    expect(sentences.some((sentence) => sentence.startsWith("On file now"))).toBe(false);
    expect(cardFormOf(element)).toBeDefined();
  });

  it("AC2: the card form is given the new card's label, the hint, Save card, and the signup's card entry words", async () => {
    await subscribedAda();
    expect(cardFormOf((await render()).element)?.text).toEqual({
      cardLabel: "New card",
      cardHint: "Secure card entry by Square. Any unpaid weeks are charged to the new card when you save it.",
      save: "Save card",
      testCard: en["supperClub.testCard"],
      cardFailed: en["supperClub.cardFailed"],
      cardRefused: en["supperClub.cardRefused"],
    });
  });

  it("AC2: with no declined rows, the card entry's amount is the subscription's weekly price", async () => {
    await subscribedAda();
    expect(cardFormOf((await render()).element)?.amountCents).toBe(4500);
  });

  it("AC2: with declined rows, it is the total of those a save would charge: a closed week's is left out", async () => {
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
  ])("AC2: the card entry's test field is gated as the signup's: %s it is %s, and billing is the member's", async (_where, e2e, testMode) => {
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
  it("AC3: the Notice reads Card saved. and when the next charge is, on the card now on file, and the form is gone", async () => {
    await subscribedAda(NEW_CARD);
    const { element, html } = await render({ state: "saved" });
    expect(alertTexts(html)).toEqual(["Card saved. Your next charge, at the end of Monday, February 8, uses card ending 1111."]);
    expect(cardFormOf(element)).toBeUndefined();
    expect(linksOf(html)).toContainEqual({ href: "/account", text: en["header.yourMeal"] });
  });
});

describe("AC4 — state retried", () => {
  it("AC4: with two rows paid, the Notice totals them on the card now on file and names both weeks, joined with a comma; the form is gone", async () => {
    const { subscriptionId } = await subscribedAda(NEW_CARD);
    const first = await services.repo.addLedgerRow(subscriptionId, JAN_24, "paid", 4500);
    const second = await services.repo.addLedgerRow(subscriptionId, JAN_31, "paid", 4500);
    const { element, html } = await render({ state: "retried", rows: `${first},${second}` });
    expect(alertTexts(html)).toEqual([`Card saved. We charged $90 to card ending 1111 for the 2 unpaid weeks: ${titleOf(JAN_24)}, ${titleOf(JAN_31)}.`]);
    expect(cardFormOf(element)).toBeUndefined();
  });

  it("AC4: with one row paid, the Notice says the unpaid week", async () => {
    const { subscriptionId } = await subscribedAda(NEW_CARD);
    const paid = await services.repo.addLedgerRow(subscriptionId, JAN_24, "paid", 4500);
    expect(alertTexts((await render({ state: "retried", rows: paid })).html)).toEqual([
      `Card saved. We charged $45 to card ending 1111 for the unpaid week: ${titleOf(JAN_24)}.`,
    ]);
  });

  it("AC4: rows that are not the subscription's paid rows are dropped: with none left, the form shows and no Notice", async () => {
    const { subscriptionId } = await subscribedAda(NEW_CARD);
    const declined = await services.repo.addLedgerRow(subscriptionId, JAN_24, "declined", 4500);
    const { element, html } = await render({ state: "retried", rows: `${declined},00000000-0000-4000-8000-000000000000` });
    expect(alertTexts(html)).toEqual([]);
    expect(cardFormOf(element)).toBeDefined();
  });
});

describe("AC5 — state declined", () => {
  it("AC5: the Notice reads That card was declined. and the rest; the old card is still on file and the form is still shown", async () => {
    await subscribedAda();
    const { element, html, sentences } = await render({ state: "declined" });
    expect(alertTexts(html)).toEqual([DECLINED]);
    expect(sentences).toContain(ON_FILE_OLD);
    expect(cardFormOf(element)).toBeDefined();
  });
});
