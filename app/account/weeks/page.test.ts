// Issue 155: Upcoming weeks, `await UpcomingWeeks()` with `next/headers` faked and the composition root mocked, as
// app/account/page.test.ts renders /account. Who is let in is requireSubscriber's (app/account/subscriber.test.ts);
// which weeks are listed is upcomingWeeks' and each week's marker upcomingRows' (src/pickup-week.test.ts,
// src/account-weeks.test.ts). Here one case of each goes through the page, and what each marker says on screen,
// read as the runs of text in its row. The markers' words are new copy, typed once here. The header is faked, so
// what is read of it is the call the page makes.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { pickupWeek, weekTitle, type ChangedWeek } from "@core/pickup-week.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { redirectOf, textsOf } from "../../screen-test-helpers";
import { SiteHeader } from "../../site-header";
import UpcomingWeeks from "./page";

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
    throw new Error("/account/weeks has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

// Wednesday, February 3, 2027, noon in Cleveland. The calendar lists from the week of February 7 (its cutoff, the
// end of Monday, February 1, passed; its pickup to come) to April 25.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const sundaysFrom = (first: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => new Date(Date.parse(`${first}T00:00:00Z`) + i * 7 * DAY).toISOString().slice(0, 10));

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

const signup = (member: Member, firstWeek: string): Promise<PendingSignup> =>
  services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 4500,
    weeklyCents: 4500,
    pickupDate: firstWeek,
    consentText: "I agree to a weekly charge of $45.",
    consentAt: new Date("2026-12-01T17:00:00.000Z"),
  });

/** Ada, signed in, with an active subscription whose first week is `firstWeek`; its id. */
const subscribedAda = async (firstWeek = "2027-01-03"): Promise<string> => {
  const member = await ada();
  const rows = await signup(member, firstWeek);
  await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
  signIn(member);
  return rows.subscriptionId;
};

const CLOSED_AT = new Date("2027-02-02T15:00:00.000Z");
const close = (weekOf: string) => services.repo.closePickupWeek(product.id, weekOf, null, CLOSED_AT);

/** The week's title with its ordinary days, as the page's language writes it. */
const titleOf = (weekOf: string, changed: ChangedWeek | null = null): string => weekTitle(t, pickupWeek(weekOf, changed), "en");

/** The page's markup, and each list row's runs of text, in order. */
const render = async (): Promise<{ html: string; rows: string[][] }> => {
  const html = renderToStaticMarkup(await UpcomingWeeks());
  const rows = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textsOf(match[1] ?? ""));
  return { html, rows };
};

const rowTitled = (rows: string[][], title: string): string[] | undefined => rows.find((row) => row[0] === title);

describe("AC1 (issue 155) — who gets in", () => {
  it("AC1: a signed-in member with no active, paid subscription is sent to /supper-club", async () => {
    signIn(await ada());
    await expect(redirectOf(UpcomingWeeks())).resolves.toBe("/supper-club");
  });

  it("AC1: a subscribed member is let in: the page lists the current week", async () => {
    await subscribedAda();
    expect((await render()).rows.map((row) => row[0])).toContain(titleOf("2027-02-07"));
  });
});

describe("AC2 (issue 155) — the 12 weeks", () => {
  it("AC2: a member whose first week has passed sees 12 weeks, earliest first, from the current week, each titled", async () => {
    await subscribedAda("2027-01-03");
    expect((await render()).rows.map((row) => row[0])).toEqual(sundaysFrom("2027-02-07", 12).map((weekOf) => titleOf(weekOf)));
  });

  it("AC2: a member whose first week is later sees 12 weeks from it", async () => {
    await subscribedAda("2027-02-21");
    expect((await render()).rows.map((row) => row[0])).toEqual(sundaysFrom("2027-02-21", 12).map((weekOf) => titleOf(weekOf)));
  });

  it("AC2: a closed week that was moved is titled by its ordinary days, its move waiting for a reopen", async () => {
    const moved: ChangedWeek = { weekOf: "2027-03-14", closedAt: CLOSED_AT, note: null, firstDay: "2027-03-13", lastDay: "2027-03-14" };
    await services.repo.savePickupWeek(product.id, moved);
    await subscribedAda();
    const titles = (await render()).rows.map((row) => row[0]);
    expect(titles).toContain(titleOf("2027-03-14"));
    expect(titles).not.toContain(titleOf("2027-03-14", moved));
  });
});

// One member's weeks: February 7 paid; February 14 paid, then closed, granting a week credit; February 21 closed
// with no charge; the week credit lands on February 28; March 7 is coming, charged at the end of Monday, March 1.
describe("AC3–AC5 (issue 155) — what each marker says, left then right", () => {
  const arrange = async (): Promise<string[][]> => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, "2027-02-07", "paid", 4500);
    await services.repo.addLedgerRow(subscriptionId, "2027-02-14", "paid", 4500);
    await close("2027-02-14");
    await close("2027-02-21");
    return (await render()).rows;
  };

  it("AC3: a Coming week says when it is charged, then Coming", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-03-07"))).toEqual([titleOf("2027-03-07"), "Charged at the end of Monday, March 1", "Coming"]);
  });

  it("AC3: a Paid week says Paid, then Paid", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-02-07"))).toEqual([titleOf("2027-02-07"), "Paid", "Paid"]);
  });

  it("AC4: a closed week with no paid row says there is no pickup and no charge, then Closed", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-02-21"))).toEqual([titleOf("2027-02-21"), "The farm is closed: no pickup, no charge.", "Closed"]);
  });

  it("AC4: a closed week with a paid row says a week credit covers a later week, then Closed", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-02-14"))).toEqual([
      titleOf("2027-02-14"),
      "The farm is closed: no pickup. A week credit covers a later week.",
      "Closed",
    ]);
  });

  it("AC5: the week the week credit lands on says it is made and not charged, then Week credit", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-02-28"))).toEqual([titleOf("2027-02-28"), "Week credit: made, not charged.", "Week credit"]);
  });
});

describe("AC9 (issue 155) — the header on Upcoming weeks", () => {
  it('AC9: the page opens with the site header, Upcoming weeks marked current: current "weeks"', async () => {
    await subscribedAda();
    await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "weeks" }));
  });
});
