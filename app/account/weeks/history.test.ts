// Issue 155: History, which issue 243 made the second list of /account/weeks: `await UpcomingWeeks()` with `next/headers`
// faked and the composition root mocked, as ./page.test.ts renders it, read in its History column. Who is let in and the
// header are ./page.test.ts's; which weeks are past is pastWeeks' and each row's marker, amount and line historyRows' (src/pickup-week.test.ts,
// src/account-weeks.test.ts). Here one case of each goes through the page, read by its row whole: the title, the meal
// and the amount as values, and the status line and badge, which the page picks by the row's line and marker, by
// their catalog lines (issue 211).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator, type MessageKey } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { formatUsdWhole } from "@core/money.js";
import { cutoffInstant, pickupWeek, weekTitle } from "@core/pickup-week.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { Badge, type BadgeKind } from "../../../components/ui/badge";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { alertTexts, textsOf } from "../../screen-test-helpers";
import { SUBSCRIPTION_BADGES } from "../../subscription-badges";
import { payDeclinedWeek } from "../declined-fixture";
import { historyColumn, listItems } from "./columns-fixture";
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
vi.mock("../../site-header", () => ({ SiteHeader: async () => createElement("header", null, "the header") }));
// The Upcoming rows' forms, which are ./page.test.ts's: each action stands in for a server reference.
vi.mock("./actions", () => ({ skipWeek: async () => {}, unskipWeek: async () => {} }));

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

/** The History column's markup, and each of its rows' runs of text, in order. */
const render = async (): Promise<{ html: string; rows: string[][] }> => {
  const html = historyColumn(renderToStaticMarkup(await UpcomingWeeks()));
  return { html, rows: listItems(html).map(textsOf) };
};

const rowTitled = (rows: string[][], title: string): string[] | undefined => rows.find((row) => row[0] === title);

// One member's past weeks: January 3 paid at signup ($45); January 10 paid by the charge run ($50); January 17
// closed with no charge; January 24 paid ($45) and then closed; January 31 neither, so not listed.
describe("AC7 (issue 155) — what each row holds", () => {
  const arrange = async (): Promise<string[][]> => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, "2027-01-10", "paid", 5000);
    await close("2027-01-17");
    await services.repo.addLedgerRow(subscriptionId, "2027-01-24", "paid", 4500);
    await close("2027-01-24");
    return (await render()).rows;
  };

  it("AC7: the first week: the meal and the amount charged at signup", async () => {
    expect(rowTitled(await arrange(), titleOf(JAN_3))).toEqual([titleOf(JAN_3), MEAL, t("account.marker.paid"), formatUsdWhole(4500), t("account.history.signup")]);
  });

  it("AC7: a later paid week: the meal and the ledger's amount", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-01-10"))).toEqual([titleOf("2027-01-10"), MEAL, t("account.marker.paid"), formatUsdWhole(5000), t("account.marker.paid")]);
  });

  it("AC7: a closed week with no charge: $0, with no meal line", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-01-17"))).toEqual([titleOf("2027-01-17"), t("account.marker.closed"), t("account.marker.noMeal"), formatUsdWhole(0)]);
  });

  it("AC7: a week closed after it was paid: the meal and the amount", async () => {
    expect(rowTitled(await arrange(), titleOf("2027-01-24"))).toEqual([titleOf("2027-01-24"), MEAL, t("account.marker.noMeal"), formatUsdWhole(4500), t("account.history.closedPaid")]);
  });
});

// Issue 214, folded into issue 230: a past week paid by a week credit. January 10 paid, then closed after its cutoff,
// grants a week credit; January 17's enrolment spends it on a 0-cent paid row. Its line and badge by their catalog lines.
describe("issue 230 — a past week paid by a week credit", () => {
  it("issue 230: a week a week credit paid: the week credit badge, $0, then the week credit line", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, "2027-01-10", "paid", 4500);
    await close("2027-01-10");
    await services.repo.enrolWeek(product.id, "2027-01-17", cutoffInstant(product, "2027-01-17"));
    const row = rowTitled((await render()).rows, titleOf("2027-01-17"));
    expect(row?.slice(-3)).toEqual([t("account.marker.weekCredit"), formatUsdWhole(0), t("account.weeks.weekCredit")]);
  });
});

// Issue 137: a past week the member skipped. Its marker, amount and line are historyRows' (src/account-weeks.test.ts),
// a week both closed and skipped among them; here the row goes through the page once.
describe("AC7 (issue 137) — a past skipped week", () => {
  it("AC7: a skipped week: $0, with no meal line", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.skipWeek(subscriptionId, "2027-01-17");
    expect(rowTitled((await render()).rows, titleOf("2027-01-17"))).toEqual([titleOf("2027-01-17"), t("account.weeks.skipped"), t("account.marker.skipped"), formatUsdWhole(0)]);
  });
});

// Issue 138: which set a paid week reads is the repository contract's (src/adapters/week-credit-contract.ts); here
// the page shows each paid week's own set once, after a switch.
describe("AC4 (issue 138) — a paid week's picks, after a switch", () => {
  it("AC4: each paid week shows the picks it was charged for: the week a switch starts from its new meal, the week before it the signup's", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, "2027-01-10", "paid", 8000);
    const vegan = Object.fromEntries(
      product.optionTypes.map((type) => [type.id, type.options.find((option) => ["3–4 people", "Vegan"].includes(option.name))?.id ?? "no such option"]),
    );
    await services.repo.switchPicks(subscriptionId, vegan, "2027-01-10", 8000);
    const { rows } = await render();
    expect(rowTitled(rows, titleOf(JAN_3))?.[1]).toBe(MEAL);
    expect(rowTitled(rows, titleOf("2027-01-10"))?.[1]).toBe("3–4 people · Vegan");
  });
});

describe("AC8 (issue 155) — no past weeks", () => {
  it("AC8: a member whose first week has not passed sees no card, no rows and no message", async () => {
    await subscribedAda("2027-02-07");
    const { html, rows } = await render();
    // A Card is a <section>.
    expect(html).not.toContain("<section");
    expect(rows).toEqual([]);
    expect(alertTexts(html)).toEqual([]);
  });
});

// Issue 139: a cancel touches no ledger row, so History is unchanged after it; here one case goes through the page.
describe("AC2, AC5 (issue 139) — History after a cancel", () => {
  it("AC2: a cancelled member's History still lists each week charged before the cancel, with its amount", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, "2027-01-24", "paid", 4500);
    expect(await services.repo.cancelSubscription(subscriptionId, NOW)).toBe(true);
    const { rows } = await render();
    expect(rows.map((row) => row[0])).toEqual([titleOf("2027-01-24"), titleOf(JAN_3)]);
    for (const row of rows) expect(row).toContain(formatUsdWhole(4500));
  });
});

// Issue 198: a locked subscription's past weeks. Each row's marker, amount and line, a closed week's among them, are
// historyRows' (src/account-weeks.test.ts); here one Locked and one Card declined row go through the page, read whole as
// above, with the badge's kind by what Badge draws for it.
describe("issue 198 — History of a locked subscription", () => {
  const JAN_17 = "2027-01-17";
  const JAN_24 = "2027-01-24";
  const JAN_31 = "2027-01-31";

  /** Ada, signed in, subscribed from January 3, with a declined row for `declinedOn`; her ids. */
  const declinedAda = async (declinedOn: string): Promise<{ memberId: string; subscriptionId: string }> => {
    const member = await ada();
    const rows = await signup(member, JAN_3);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    await services.repo.addLedgerRow(rows.subscriptionId, declinedOn, "declined", 4500);
    signIn(member);
    return { memberId: member.id, subscriptionId: rows.subscriptionId };
  };

  /** What Badge draws for `kind` with the catalog line `key`. */
  const badgeOf = (kind: BadgeKind, key: MessageKey): string => renderToStaticMarkup(createElement(Badge, { kind, children: t(key) }));

  /** The markup of the row titled `title`. */
  const rowMarkup = (html: string, title: string): string =>
    [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1] ?? "").find((inner) => textsOf(inner)[0] === title) ?? "";

  it("AC10: after the card update, a past week holding a locked row is Locked: the locked line, $0, the Locked badge of the locked kind, in date order among the others", async () => {
    // January 17 declined; the runs at the next two cutoffs locked January 24 and 31; then a card update paid January 17.
    const { memberId, subscriptionId } = await declinedAda(JAN_17);
    await services.repo.addLedgerRow(subscriptionId, JAN_24, "locked", 0);
    await services.repo.addLedgerRow(subscriptionId, JAN_31, "locked", 0);
    await payDeclinedWeek(services.repo, memberId, subscriptionId, NOW);
    const { html, rows } = await render();
    expect(rows.map((row) => row[0])).toEqual([titleOf(JAN_31), titleOf(JAN_24), titleOf(JAN_17), titleOf(JAN_3)]);
    expect(rowTitled(rows, titleOf(JAN_24))).toEqual([titleOf(JAN_24), t("account.history.locked"), t("account.marker.locked"), formatUsdWhole(0)]);
    expect(rowMarkup(html, titleOf(JAN_24))).toContain(badgeOf("locked", "account.marker.locked"));
  });

  it("AC12: a past declined week, unpaid, is Card declined, as account home's badge: the declined line and $0, with no meal line", async () => {
    await declinedAda(JAN_31);
    const { html, rows } = await render();
    expect(rowTitled(rows, titleOf(JAN_31))).toEqual([titleOf(JAN_31), t("account.history.declined"), t(SUBSCRIPTION_BADGES.declined.key), formatUsdWhole(0)]);
    expect(rowMarkup(html, titleOf(JAN_31))).toContain(badgeOf(SUBSCRIPTION_BADGES.declined.kind, SUBSCRIPTION_BADGES.declined.key));
  });

  it("AC13: once a card update pays the declined week, it is Paid, with its meal and amount, as any paid week; guards AC12", async () => {
    const { memberId, subscriptionId } = await declinedAda(JAN_31);
    await payDeclinedWeek(services.repo, memberId, subscriptionId, NOW);
    expect(rowTitled((await render()).rows, titleOf(JAN_31))).toEqual([titleOf(JAN_31), MEAL, t("account.marker.paid"), formatUsdWhole(4500), t("account.marker.paid")]);
  });
});
