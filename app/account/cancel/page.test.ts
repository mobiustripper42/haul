// Issue 139: the member's cancel confirm, `await CancelSupperClub()` with `next/headers` faked and the composition root
// mocked, as app/account/page.test.ts renders /account. Who is let in is requireSubscriber's
// (app/account/subscriber.test.ts) and which week is the last pickup lastPickup's (src/account-weeks.test.ts); here
// each of the page's branches goes through it once. What the button does is ./actions.test.ts's. The page's words are
// new copy, typed once here; "Your Supper Club" is the account title, read from the catalog.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { en } from "@core/messages/en.js";
import { pickupWeek, weekTitle } from "@core/pickup-week.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { alertTexts, attributesOf, redirectOf, sentencesOf, textsOf } from "../../screen-test-helpers";
import CancelSupperClub from "./page";

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
  getEmail: () => {
    throw new Error("/account/cancel has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));
// The confirm's action, standing in for a server reference: React writes what `$$FORM_ACTION` gives as the form's
// `action`, so the markup names the action the button posts to.
vi.mock("./actions", () => ({
  cancelSubscription: Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: "$ACTION_ID_cancelSubscription", action: "cancelSubscription" }) }),
}));

// Wednesday, February 3, 2027, noon in Cleveland. Upcoming weeks lists from February 7; January 31's pickup has passed.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const FEB_7 = "2027-02-07";

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
});

const signIn = (member: Member): void => {
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(Date.now() + DAY).toISOString() }, services.secret);
};

const ada = (): Promise<Member> =>
  services.repo.saveAccount({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "(216) 555-0134", language: "en" });

const signup = (member: Member): Promise<PendingSignup> =>
  services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 4500,
    weeklyCents: 4500,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $45.",
    consentAt: new Date("2026-12-01T17:00:00.000Z"),
  });

/** Ada, signed in, with an active subscription paid for January 3; its id. */
const subscribedAda = async (): Promise<string> => {
  const member = await ada();
  const rows = await signup(member);
  await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
  signIn(member);
  return rows.subscriptionId;
};

/** A week of Ada's charged and then closed: a week credit. */
const weekCredit = async (subscriptionId: string, weekOf: string): Promise<void> => {
  await services.repo.addLedgerRow(subscriptionId, weekOf, "paid", 4500);
  await services.repo.closePickupWeek(product.id, weekOf, null, new Date(`${weekOf}T16:00:00.000Z`));
};

const titleOf = (weekOf: string): string => weekTitle(t, pickupWeek(weekOf, null), "en");

const render = async (): Promise<{ html: string; sentences: string[] }> => {
  const html = renderToStaticMarkup(await CancelSupperClub());
  // The page has no badge, so a line in a <span> beside another reads through as one sentence.
  return { html, sentences: sentencesOf(html, ["span"]) };
};

/** Each link on the page: where it goes, and its text. */
const linksOf = (html: string): { href: string; text: string }[] =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    href: attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "",
    text: textsOf(inner).join(" "),
  }));

const HEADING = "Cancel the Supper Club?";
const JOIN_AGAIN = "You can join again any time while there are meals. If you only need a break, skip the weeks instead.";
const CONFIRM = "Yes, cancel my Supper Club";
const SKIP_INSTEAD = "Skip weeks instead";

describe("AC11 (issue 139) — who reaches /account/cancel", () => {
  it("AC11: a signed-out visitor is sent to /sign-in", async () => {
    await expect(redirectOf(CancelSupperClub())).resolves.toBe("/sign-in");
  });

  it("AC11: a signed-in member with no subscription is sent to /supper-club", async () => {
    signIn(await ada());
    await expect(redirectOf(CancelSupperClub())).resolves.toBe("/supper-club");
  });

  it("AC10: a member whose subscription is already cancelled is sent to /account", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.cancelSubscription(subscriptionId, NOW);
    await expect(redirectOf(CancelSupperClub())).resolves.toBe("/account");
  });
});

describe("AC13 (issue 139) — the words and their order", () => {
  it("AC13: with a paid week to come, the back link, the heading, the last pickup sentence, the join-again line, the confirm and Skip weeks instead", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "paid", 4500);
    const { sentences } = await render();
    const wanted = [
      en["account.title"],
      HEADING,
      `Your last pickup is ${titleOf(FEB_7)}, which you already paid for. Nothing more is charged.`,
      JOIN_AGAIN,
      CONFIRM,
      SKIP_INSTEAD,
    ];
    expect(sentences.filter((sentence) => wanted.includes(sentence))).toEqual(wanted);
  });

  it("AC13: the back link goes to /account and Skip weeks instead to Upcoming weeks", async () => {
    await subscribedAda();
    const links = linksOf((await render()).html);
    expect(links).toContainEqual({ href: "/account", text: en["account.title"] });
    expect(links).toContainEqual({ href: "/account/weeks", text: SKIP_INSTEAD });
  });

  it("AC13: with no paid week still to come, the sentence is Nothing more is charged. alone", async () => {
    await subscribedAda();
    const { sentences } = await render();
    expect(sentences).toContain("Nothing more is charged.");
    expect(sentences.some((sentence) => sentence.startsWith("Your last pickup"))).toBe(false);
  });

  it("AC13: with no week credit there is no Notice", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "paid", 4500);
    const { html, sentences } = await render();
    expect(sentences).toContain(CONFIRM);
    expect(alertTexts(html)).toEqual([]);
  });

  it("AC4, AC13: with one unused week credit, a Notice says so and that the farm refunds it, before the confirm", async () => {
    const subscriptionId = await subscribedAda();
    await weekCredit(subscriptionId, "2027-01-24");
    const { html, sentences } = await render();
    expect(alertTexts(html)).toEqual(["You have a week credit. The farm refunds it in Square after you cancel."]);
    expect(sentences.indexOf("You have a week credit. The farm refunds it in Square after you cancel.")).toBeLessThan(sentences.indexOf(CONFIRM));
  });

  it("AC4, AC13: with two, the Notice counts them", async () => {
    const subscriptionId = await subscribedAda();
    await weekCredit(subscriptionId, "2027-01-17");
    await weekCredit(subscriptionId, "2027-01-24");
    expect(alertTexts((await render()).html)).toEqual(["You have 2 week credits. The farm refunds it in Square after you cancel."]);
  });
});

describe("AC1 (issue 139) — the confirm", () => {
  it("AC1: Yes, cancel my Supper Club is the submit of a form posting to cancelSubscription", async () => {
    await subscribedAda();
    const { html } = await render();
    const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)];
    expect(forms).toHaveLength(1);
    const [, attrs = "", inner = ""] = forms[0] ?? [];
    const buttons = attributesOf(inner, "button");
    const action = buttons.find((button) => button.formaction !== undefined)?.formaction ?? attributesOf(`<form${attrs}>`, "form")[0]?.action;
    expect(action).toBe("cancelSubscription");
    const submits = [...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].filter(([, a = ""]) => attributesOf(`<button${a}>`, "button")[0]?.type === "submit");
    expect(submits.map(([, , text = ""]) => textsOf(text).join(" "))).toEqual([CONFIRM]);
  });
});
