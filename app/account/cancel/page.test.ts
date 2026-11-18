// Issue 139: the member's cancel confirm, `await CancelSupperClub()` with `next/headers` faked and the composition root
// mocked, as app/account/page.test.ts renders /account. Who is let in is requireSubscriber's
// (app/account/subscriber.test.ts) and which week is the last pickup lastPickup's (src/account-weeks.test.ts); here
// each of the page's branches goes through it once, read by its links, form, Notice and the values in them, and the key
// of the credit line it picks, never its words (issue 211). What the button does is ./actions.test.ts's.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { pickupWeek, weekTitle } from "@core/pickup-week.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { alertTexts, attributesOf, redirectOf, screenMarkup } from "../../screen-test-helpers";
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

/** The page's markup, React's script dropped and entities decoded, so a week's title can be found in it. */
const render = async (): Promise<{ html: string }> => ({ html: screenMarkup(renderToStaticMarkup(await CancelSupperClub())) });

/** Where each link on the page goes. */
const hrefsOf = (html: string): string[] => attributesOf(html, "a").map((link) => link.href ?? "");

/** The submit buttons on the page. */
const submitsOf = (html: string) => attributesOf(html, "button").filter((button) => button.type === "submit");

/** Each of `marks` is on the page, each after the one before it. */
const inPageOrder = (html: string, marks: readonly string[]): boolean => {
  const at = marks.map((mark) => html.indexOf(mark));
  return at.every((n, i) => n >= 0 && (i === 0 || n > (at[i - 1] ?? -1)));
};

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

describe("AC13 (issue 139) — what the page holds, and its order", () => {
  it("AC13: with a paid week to come, the back link, the heading, the last pickup's week, the confirm and Skip weeks instead", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "paid", 4500);
    const { html } = await render();
    expect(inPageOrder(html, ['href="/account"', "<h1", titleOf(FEB_7), 'type="submit"', 'href="/account/weeks"'])).toBe(true);
  });

  it("AC13: the back link goes to /account and Skip weeks instead to Upcoming weeks", async () => {
    await subscribedAda();
    const hrefs = hrefsOf((await render()).html);
    expect(hrefs).toContain("/account");
    expect(hrefs).toContain("/account/weeks");
  });

  it("AC13: with no paid week still to come, no week is named", async () => {
    await subscribedAda();
    const { html } = await render();
    for (const weekOf of ["2027-01-03", FEB_7]) expect(html).not.toContain(titleOf(weekOf));
  });

  it("AC13: with no week credit there is no Notice", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "paid", 4500);
    const { html } = await render();
    expect(submitsOf(html)).toHaveLength(1);
    expect(alertTexts(html)).toEqual([]);
  });

  it("AC4, AC13: with one unused week credit, a Notice shows the one-credit line, before the confirm", async () => {
    const subscriptionId = await subscribedAda();
    await weekCredit(subscriptionId, "2027-01-24");
    const { html } = await render();
    const alerts = alertTexts(html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(t("account.cancel.creditOne"));
    expect(inPageOrder(html, ['role="alert"', 'type="submit"'])).toBe(true);
  });

  it("AC4, AC13: with two, the Notice counts them", async () => {
    const subscriptionId = await subscribedAda();
    await weekCredit(subscriptionId, "2027-01-17");
    await weekCredit(subscriptionId, "2027-01-24");
    const alerts = alertTexts((await render()).html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("2");
    expect(alerts[0]).toContain(t("account.cancel.creditMany", { n: 2 }));
  });
});

describe("AC1 (issue 139) — the confirm", () => {
  it("AC1: the one submit is in a form posting to cancelSubscription", async () => {
    await subscribedAda();
    const { html } = await render();
    const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)];
    expect(forms).toHaveLength(1);
    const [, attrs = "", inner = ""] = forms[0] ?? [];
    const buttons = attributesOf(inner, "button");
    const action = buttons.find((button) => button.formaction !== undefined)?.formaction ?? attributesOf(`<form${attrs}>`, "form")[0]?.action;
    expect(action).toBe("cancelSubscription");
    expect(submitsOf(inner)).toHaveLength(1);
    expect(submitsOf(html)).toHaveLength(1);
  });
});
