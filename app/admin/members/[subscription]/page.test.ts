// Issue 139: the admin's minimal member page, `await AdminMember({ params, searchParams })` with `next/headers` faked
// and the composition root mocked, as app/admin/page.test.ts renders /admin. Who counts as an admin is
// app/session.test.ts's; which subscriptions the page can find is listSubscribers' and refundOwed its
// (src/adapters/signup-contract.ts); which week is the last pickup lastPickup's (src/account-weeks.test.ts). Here each of
// the page's states goes through it once. What the confirm does is ./actions.test.ts's. The page's words are new copy,
// typed once here; "Active" is the account's badge word, read from the catalog.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import { en } from "@core/messages/en.js";
import type { Role } from "@core/members.js";
import { pickupWeek, weekTitle } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { AdminNav } from "../../admin-nav";
import { emptyRequest } from "../../../next-headers-fake";
import { attributesOf, redirectOf, sentencesOf, textsOf } from "../../../screen-test-helpers";
import { addSupperClub, pendingSignup } from "../../subscribers-fixture";
import AdminMember from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
// `notFound` throws as the real one does, so a test can tell it from a redirect and from a page.
vi.mock("next/navigation", async () => ({
  redirect: (await import("../../../screen-test-helpers")).throwingRedirect,
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("the admin member page has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));
vi.mock("../../admin-nav", () => ({ AdminNav: vi.fn(async () => createElement("nav", null, "the admin nav")) }));
// The confirm's action, standing in for a server reference: React writes what `$$FORM_ACTION` gives as the form's
// `action`, so the markup names the action the button posts to.
vi.mock("./actions", () => ({
  cancelForMember: Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: "$ACTION_ID_cancelForMember", action: "cancelForMember" }) }),
}));

// Wednesday, February 3, 2027, noon in Cleveland. Upcoming weeks lists from February 7; January 31's pickup has passed.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const FEB_7 = "2027-02-07";
const ROSA = { email: "rosa@example.com", firstName: "Rosa", lastName: "Bennett", phone: "(216) 555-0187" };
const PICKS = ["2 people", "Vegan"];

const t = createTranslator("en");

let product: ProductWithOptions;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.mocked(AdminNav).mockClear();
  product = addSupperClub(services.repo);
});

afterEach(() => {
  vi.useRealTimers();
});

async function signInAs(role: Role): Promise<string> {
  const member = await services.repo.createMember({ email: "lenny@example.com", role });
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(Date.now() + DAY).toISOString() }, services.secret);
  return member.id;
}

/** Rosa with an active subscription paid for January 3; its id. */
const rosa = async (): Promise<string> => {
  const signup = await pendingSignup(services.repo, product, ROSA, PICKS);
  await services.repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, new Date("2026-12-01T17:00:05.000Z"));
  return signup.subscriptionId;
};

/** A week of the subscription's charged and then closed: a week credit. */
const weekCredit = async (subscriptionId: string, weekOf: string): Promise<void> => {
  await services.repo.addLedgerRow(subscriptionId, weekOf, "paid", 5000);
  await services.repo.closePickupWeek(product.id, weekOf, null, new Date(`${weekOf}T16:00:00.000Z`));
};

const pageOf = (subscription: string, query: { cancel?: string } = {}) =>
  AdminMember({ params: Promise.resolve({ subscription }), searchParams: Promise.resolve(query) });

const render = async (subscription: string, query: { cancel?: string } = {}) => {
  const html = renderToStaticMarkup(await pageOf(subscription, query));
  return { html, sentences: sentencesOf(html) };
};

/** True when the page was Next's not-found. */
const notFoundOf = async (pending: Promise<unknown>): Promise<boolean> => {
  try {
    await pending;
  } catch (e) {
    if ((e as { notFound?: unknown } | null)?.notFound === true) return true;
    throw e;
  }
  return false;
};

/** Each link on the page: where it goes, as a path and query, and its text. */
const linksOf = (html: string): { to: string; text: string }[] =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => {
    const url = new URL(attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "", "http://haul.test/admin");
    return { to: `${url.pathname}${url.search}`, text: textsOf(inner).join(" ") };
  });

/** Each form: the action it posts to, its hidden fields, and its submit buttons' words. */
const formsOf = (html: string) =>
  [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, attrs = "", inner = ""]) => {
    const buttons = attributesOf(inner, "button");
    return {
      action: buttons.find((button) => button.formaction !== undefined)?.formaction ?? attributesOf(`<form${attrs}>`, "form")[0]?.action ?? "",
      hidden: Object.fromEntries(attributesOf(inner, "input").filter((input) => input.type === "hidden").map((input) => [input.name, input.value])),
      submits: [...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
        .filter(([, a = ""]) => attributesOf(`<button${a}>`, "button")[0]?.type === "submit")
        .map(([, , text = ""]) => textsOf(text).join(" ")),
    };
  });

const titleOf = (weekOf: string): string => weekTitle(t, pickupWeek(weekOf, null), "en");

const CARD_HEADING = "Cancel the Supper Club for Rosa Bennett?";
const NOTHING_MORE = "Nothing more is charged, and they can sign up again. Do this only when they asked you to.";
const CREDIT_LINE = "They have a week credit; refund it in Square.";

describe("AC11 (issue 139) — only an admin opens the member page", () => {
  it("AC11: a signed-out visitor is sent to /sign-in", async () => {
    const subscriptionId = await rosa();
    await expect(redirectOf(pageOf(subscriptionId))).resolves.toBe("/sign-in");
  });

  it("AC11: a signed-in member whose role is not admin goes to /", async () => {
    const subscriptionId = await rosa();
    await signInAs("member");
    await expect(redirectOf(pageOf(subscriptionId))).resolves.toBe("/");
  });
});

describe("Interfaces 11 (issue 139) — a subscription the members list does not hold is not found", () => {
  it.each([
    ["an unknown id", async () => "00000000-0000-4000-8000-000000000000"],
    ["a string that isn't a UUID", async () => "not-a-uuid"],
    ["a pending signup", async () => (await pendingSignup(services.repo, product, { email: "wait@example.com" }, PICKS)).subscriptionId],
    [
      "another product's subscription",
      async () => {
        const crate = addSupperClub(services.repo, { name: "Crate" });
        const signup = await pendingSignup(services.repo, crate, { email: "crate@example.com" }, PICKS);
        await services.repo.confirmSignupRows(signup.ledgerId, "PAYMENT_CRATE", signup.amountCents, NOW);
        return signup.subscriptionId;
      },
    ],
  ])("AC11: %s is the not-found page", async (_what, idOf) => {
    await signInAs("admin");
    const subscriptionId = await idOf();
    await expect(notFoundOf(pageOf(subscriptionId))).resolves.toBe(true);
  });
});

describe("AC13 (issue 139) — the page, as it opens", () => {
  it('AC13: the admin nav with Members current, then All members back to /admin, the heading "Bennett, Rosa" and Active', async () => {
    await signInAs("admin");
    const subscriptionId = await rosa();
    const { html, sentences } = await render(subscriptionId);
    expect(AdminNav).toHaveBeenCalledWith({ current: "members" });
    const wanted = ["the admin nav", "All members", "Bennett, Rosa", en["account.active"]];
    expect(sentences.filter((sentence) => wanted.includes(sentence))).toEqual(wanted);
    expect(linksOf(html)).toContainEqual({ to: "/admin", text: "All members" });
  });

  it("AC8: while active, Cancel for this member is a link to the page with ?cancel=1, and there is no form", async () => {
    await signInAs("admin");
    const subscriptionId = await rosa();
    const { html } = await render(subscriptionId);
    expect(linksOf(html)).toContainEqual({ to: `/admin/members/${subscriptionId}?cancel=1`, text: "Cancel for this member" });
    expect(formsOf(html)).toEqual([]);
  });
});

describe("AC8, AC13 (issue 139) — the confirm, at ?cancel=1", () => {
  it("AC13: with a paid week to come, the card's heading, the last pickup sentence, the confirm posting the subscription to cancelForMember, and Keep it", async () => {
    await signInAs("admin");
    const subscriptionId = await rosa();
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "paid", 5000);
    const { html, sentences } = await render(subscriptionId, { cancel: "1" });
    const wanted = [CARD_HEADING, `Their last pickup is ${titleOf(FEB_7)}, already paid. ${NOTHING_MORE}`, "Cancel their Supper Club", "Keep it"];
    expect(sentences.filter((sentence) => wanted.includes(sentence))).toEqual(wanted);
    expect(formsOf(html)).toEqual([{ action: "cancelForMember", hidden: { subscription: subscriptionId }, submits: ["Cancel their Supper Club"] }]);
    expect(linksOf(html)).toContainEqual({ to: `/admin/members/${subscriptionId}`, text: "Keep it" });
    expect(sentences).not.toContain("Cancel for this member");
  });

  it("AC13: with no paid week still to come, the sentence has no last pickup", async () => {
    await signInAs("admin");
    const subscriptionId = await rosa();
    const { sentences } = await render(subscriptionId, { cancel: "1" });
    expect(sentences).toContain(NOTHING_MORE);
    expect(sentences.some((sentence) => sentence.startsWith("Their last pickup"))).toBe(false);
  });

  it.each([1, 2])("AC4, AC13: with %i unused week credits, the card says They have a week credit; refund it in Square., one wording whatever the count", async (count) => {
    await signInAs("admin");
    const subscriptionId = await rosa();
    for (const weekOf of ["2027-01-17", "2027-01-24"].slice(0, count)) await weekCredit(subscriptionId, weekOf);
    expect((await render(subscriptionId, { cancel: "1" })).sentences).toContain(CREDIT_LINE);
  });

  it("AC13: with no week credit, there is no credit line", async () => {
    await signInAs("admin");
    const subscriptionId = await rosa();
    const { sentences } = await render(subscriptionId, { cancel: "1" });
    expect(sentences).toContain(CARD_HEADING);
    expect(sentences).not.toContain(CREDIT_LINE);
  });
});

describe("AC4, AC9 (issue 139) — a cancelled subscription", () => {
  it("AC4: with a refund owed, the heading's badge reads Cancelled with Refund owed beside it, and there is no button, even at ?cancel=1", async () => {
    await signInAs("admin");
    const subscriptionId = await rosa();
    await weekCredit(subscriptionId, "2027-01-24");
    await services.repo.cancelSubscription(subscriptionId, NOW);
    for (const query of [{}, { cancel: "1" }]) {
      const { html, sentences } = await render(subscriptionId, query);
      const wanted = ["Bennett, Rosa", "Cancelled", "Refund owed"];
      expect(sentences.filter((sentence) => wanted.includes(sentence))).toEqual(wanted);
      expect(sentences).not.toContain(CARD_HEADING);
      expect(sentences).not.toContain("Cancel for this member");
      expect(formsOf(html)).toEqual([]);
    }
  });

  it("AC4: with no week credit, the badge reads Cancelled alone", async () => {
    await signInAs("admin");
    const subscriptionId = await rosa();
    await services.repo.cancelSubscription(subscriptionId, NOW);
    const { sentences } = await render(subscriptionId);
    expect(sentences).toContain("Cancelled");
    expect(sentences).not.toContain("Refund owed");
  });
});
