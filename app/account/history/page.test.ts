// Issue 155: History, `await History()` with `next/headers` faked and the composition root mocked, as
// app/account/page.test.ts renders /account. Who is let in is requireSubscriber's (app/account/subscriber.test.ts);
// which weeks are past is pastWeeks' and each row's marker, amount and line historyRows' (src/pickup-week.test.ts,
// src/account-weeks.test.ts). Here one case of each goes through the page, and what each row says on screen, read
// as the runs of text in its row. The page's words are new copy, typed once here. The header is faked, so what is
// read of it is the call the page makes.
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
import { redirectOf, textsOf } from "../../screen-test-helpers";
import { SiteHeader } from "../../site-header";
import History from "./page";

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
    throw new Error("/account/history has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

// Wednesday, February 3, 2027, noon in Cleveland: January 31's pickup ended Monday, February 1; February 7's is to come.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const JAN_3 = "2027-01-03";

const t = createTranslator("en");

let product: ProductWithOptions;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.mocked(SiteHeader).mockClear();
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

/** Ada's signup rows for `firstWeek`, picking 2 people, Standard, at $45 a week. */
const signup = (member: Member, firstWeek: string): Promise<PendingSignup> =>
  services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(
      product.optionTypes.map((type) => [type.id, type.options.find((option) => ["2 people", "Standard"].includes(option.name))?.id ?? "no such option"]),
    ),
    firstChargeCents: 4500,
    weeklyCents: 4500,
    pickupDate: firstWeek,
    consentText: "I agree to a weekly charge of $45.",
    consentAt: new Date("2026-12-01T17:00:00.000Z"),
  });

/** Ada, signed in, with an active subscription whose first week is `firstWeek`; its id. */
const subscribedAda = async (firstWeek = JAN_3): Promise<string> => {
  const member = await ada();
  const rows = await signup(member, firstWeek);
  await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
  signIn(member);
  return rows.subscriptionId;
};

const close = (weekOf: string) => services.repo.closePickupWeek(product.id, weekOf, null, new Date("2027-01-12T15:00:00.000Z"));

const titleOf = (weekOf: string): string => weekTitle(t, pickupWeek(weekOf, null), "en");

const MEAL = "2 people · Standard";

/** The page's markup, its runs of text, and each list row's runs, in order. */
const render = async (): Promise<{ html: string; runs: string[]; rows: string[][] }> => {
  const html = renderToStaticMarkup(await History());
  const rows = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textsOf(match[1] ?? ""));
  return { html, runs: textsOf(html), rows };
};

const rowTitled = (rows: string[][], title: string): string[] | undefined => rows.find((row) => row[0] === title);

describe("AC1 (issue 155) — who gets in", () => {
  it("AC1: a signed-in member with no active, paid subscription is sent to /supper-club", async () => {
    signIn(await ada());
    await expect(redirectOf(History())).resolves.toBe("/supper-club");
  });

  it("AC1: a subscribed member is let in: the page lists their first week", async () => {
    await subscribedAda();
    expect((await render()).rows.map((row) => row[0])).toContain(titleOf(JAN_3));
  });
});

// One member's past weeks: January 3 paid at signup ($45); January 10 paid by the charge run ($50); January 17
// closed with no charge; January 24 paid ($45) and then closed; January 31 neither, so not listed.
describe("AC7 (issue 155) — what each row says, left then right", () => {
  const arrange = async (): Promise<string[][]> => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, "2027-01-10", "paid", 5000);
    await close("2027-01-17");
    await services.repo.addLedgerRow(subscriptionId, "2027-01-24", "paid", 4500);
    await close("2027-01-24");
    return (await render()).rows;
  };

  it("AC7: the first week: the meal, Paid at signup, the amount charged, then Paid", async () => {
    expect(rowTitled(await arrange(), titleOf(JAN_3))).toEqual([titleOf(JAN_3), MEAL, "Paid at signup", "$45", "Paid"]);
  });

  it("AC7: a later paid week: the meal, Paid, the ledger's amount, then Paid", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-01-10"))).toEqual([titleOf("2027-01-10"), MEAL, "Paid", "$50", "Paid"]);
  });

  it("AC7: a closed week with no charge: Closed, $0, then No meal, with no meal line", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-01-17"))).toEqual([titleOf("2027-01-17"), "Closed", "$0", "No meal"]);
  });

  it("AC7: a week closed after it was paid: the meal, that a week credit covers a later week, the amount, then No meal", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-01-24"))).toEqual([
      titleOf("2027-01-24"),
      MEAL,
      "Closed after it was paid: a week credit covers a later week.",
      "$45",
      "No meal",
    ]);
  });
});

describe("AC8 (issue 155) — no past weeks", () => {
  it("AC8: a member whose first week has not passed sees the heading and the intro line only: no card and no message", async () => {
    await subscribedAda("2027-02-07");
    const { html, runs } = await render();
    expect(runs).toEqual(["the header", "History", "Every week since your first pickup, newest first."]);
    // A Card is a <section>.
    expect(html).not.toContain("<section");
  });
});

describe("AC9 (issue 155) — the header on History", () => {
  it('AC9: the page opens with the site header, History marked current: current "history"', async () => {
    await subscribedAda();
    await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "history" }));
  });
});
