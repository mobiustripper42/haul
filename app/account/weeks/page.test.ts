// Issue 155: Upcoming weeks, `await UpcomingWeeks()` with `next/headers` faked and the composition root mocked, as
// app/account/page.test.ts renders /account. Who is let in is requireSubscriber's (app/account/subscriber.test.ts);
// which weeks are listed is upcomingWeeks' and each week's marker upcomingRows' (src/pickup-week.test.ts,
// src/account-weeks.test.ts), which also owns what each marker is. Here one case goes through the page, read by the
// values, forms and links in each row and card, and a row's line and badge, which the page picks by its marker, by
// their catalog lines (issue 211). The header is faked, so what is read
// of it is the call the page makes.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator, type MessageKey } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { formatUsdWhole } from "@core/money.js";
import { formatPickupDate, pickupWeek, weekTitle, type ChangedWeek } from "@core/pickup-week.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { Badge, type BadgeKind } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { ACCOUNT_CARD_PATH } from "../../paths";
import { alertTexts, attributesOf, redirectOf, textsOf } from "../../screen-test-helpers";
import { SiteHeader } from "../../site-header";
import { SUBSCRIPTION_BADGES } from "../../subscription-badges";
import { payDeclinedWeek } from "../declined-fixture";
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
// Issue 137: the row buttons' actions, each standing in for a server reference: React writes what `$$FORM_ACTION`
// gives as the form's `action`, so the markup names the action a button posts to. What they do is ./actions.test.ts's.
vi.mock("./actions", () => ({
  skipWeek: Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: "$ACTION_ID_skipWeek", action: "skipWeek" }) }),
  unskipWeek: Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: "$ACTION_ID_unskipWeek", action: "unskipWeek" }) }),
  switchMeal: Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: "$ACTION_ID_switchMeal", action: "switchMeal" }) }),
}));

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
    const { rows } = await render();
    const titles = rows.map((row) => row[0]);
    expect(titles).toContain(titleOf("2027-03-14"));
    expect(titles).not.toContain(titleOf("2027-03-14", moved));
    // Closed with no charge: its line and the Closed badge, by their catalog lines.
    expect(rowTitled(rows, titleOf("2027-03-14"))?.slice(1, 3)).toEqual([t("account.weeks.closedNoCharge"), t("account.marker.closed")]);
  });
});

// Which marker each week takes is upcomingRows' (src/account-weeks.test.ts); here the coming week's charge day, the one
// value a marker's line carries, goes through the page. March 7 is coming, charged at the end of Monday, March 1.
describe("AC3 (issue 155) — a coming week's row", () => {
  // The whole page is coming weeks, so an ordinary one takes no badge and the badges mark what differs (Eric, PR #160).
  it("AC3: a coming week names the day it is charged, has no badge, then Skip posting the week", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, "2027-02-07", "paid", 4500);
    const { html, rows } = await render();
    const row = rowTitled(rows, titleOf(MAR_7));
    expect(row).toHaveLength(3);
    expect(row?.[1]).toBe(t("account.weeks.charged", { date: formatPickupDate("2027-03-01", "en") }));
    expect(formsIn(html, titleOf(MAR_7))).toEqual([{ action: "skipWeek", week: MAR_7 }]);
  });
});

describe("AC9 (issue 155) — the header on Upcoming weeks", () => {
  it('AC9: the page opens with the site header, Upcoming weeks marked current: current "weeks"', async () => {
    await subscribedAda();
    await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "weeks" }));
  });
});

// Issue 137: Skip and Unskip. Which week has which button is upcomingRows' (src/account-weeks.test.ts) and what a
// press does ./actions.test.ts's; here one row of each kind goes through the page. The new words are typed once,
// in the test of the criterion that brings them.

/** The page drawn after a redirect back with `query`. */
const renderWith = async (query: { error?: string }): Promise<string> => renderToStaticMarkup(await UpcomingWeeks({ searchParams: Promise.resolve(query) }));

/** Each form in the row titled `title`: the action it posts to, and the `week` it posts. */
const formsIn = (html: string, title: string): { action: string; week: string }[] => {
  const row = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1] ?? "").find((inner) => textsOf(inner)[0] === title);
  if (row === undefined) throw new Error(`no row titled ${title}`);
  return [...row.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, attrs = "", inner = ""]) => {
    const buttons = attributesOf(inner, "button");
    const action = buttons.find((button) => button.formaction !== undefined)?.formaction ?? attributesOf(`<form${attrs}>`, "form")[0]?.action ?? "";
    const week = [...attributesOf(inner, "input"), ...buttons].find((control) => control.name === "week")?.value ?? "";
    return { action, week };
  });
};

const MAR_7 = "2027-03-07";
const MAR_14 = "2027-03-14";

describe("AC1, AC6 (issue 137) — Skip and Unskip on the rows", () => {
  /** Ada's weeks with March 7 skipped: February 7 is Coming past its cutoff, March 14 Coming before it. */
  const arrange = async (): Promise<{ html: string; rows: string[][] }> => {
    const subscriptionId = await subscribedAda();
    await services.repo.skipWeek(subscriptionId, MAR_7);
    return render();
  };

  it("AC6: a Skipped week's Unskip is a form of its own, posting the week to unskipWeek", async () => {
    const { html, rows } = await arrange();
    expect(rowTitled(rows, titleOf(MAR_7))?.slice(1, 3)).toEqual([t("account.weeks.skipped"), t("account.marker.skipped")]);
    expect(formsIn(html, titleOf(MAR_7))).toEqual([{ action: "unskipWeek", week: MAR_7 }]);
  });

  it("AC6: a Coming week's Skip is a form of its own, posting the week to skipWeek", async () => {
    expect(formsIn((await arrange()).html, titleOf(MAR_14))).toEqual([{ action: "skipWeek", week: MAR_14 }]);
  });

  it("AC6: a Coming week whose cutoff has passed has no button: its line, naming the charge day, and nothing after", async () => {
    const { html, rows } = await arrange();
    const row = rowTitled(rows, titleOf("2027-02-07"));
    expect(row).toHaveLength(2);
    expect(row?.[1]).toContain(formatPickupDate("2027-02-01", "en"));
    expect(formsIn(html, titleOf("2027-02-07"))).toEqual([]);
  });
});

describe("AC5 (issue 137) — a skipped Week credit week", () => {
  // Where the week credit lands then is upcomingRows' (src/account-weeks.test.ts); here the skipped week's Unskip.
  it("AC5: the Week credit week skipped is Skipped, with Unskip posting the week", async () => {
    // February 14 paid, then closed: its week credit lands on February 21, which is skipped, so on February 28.
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, "2027-02-14", "paid", 4500);
    await close("2027-02-14");
    await services.repo.skipWeek(subscriptionId, "2027-02-21");
    const { html, rows } = await render();
    expect(formsIn(html, titleOf("2027-02-21"))).toEqual([{ action: "unskipWeek", week: "2027-02-21" }]);
    // February 14 closed after it was paid, and February 28 the week credit's: each line and badge by its catalog line.
    expect(rowTitled(rows, titleOf("2027-02-14"))?.slice(1, 3)).toEqual([t("account.weeks.closedPaid"), t("account.marker.closed")]);
    expect(rowTitled(rows, titleOf("2027-02-28"))?.slice(1, 3)).toEqual([t("account.weeks.weekCredit"), t("account.marker.weekCredit")]);
  });
});

describe("AC3 (issue 137) — the cutoff Notice", () => {
  it("AC3: sent back with ?error=cutoff, the page shows the cutoff Notice", async () => {
    await subscribedAda();
    expect(alertTexts(await renderWith({ error: "cutoff" }))).toHaveLength(1);
  });

  it("AC3: with no error, or another one, there is no Notice", async () => {
    await subscribedAda();
    expect(alertTexts((await render()).html)).toEqual([]);
    expect(alertTexts(await renderWith({}))).toEqual([]);
    expect(alertTexts(await renderWith({ error: "nope" }))).toEqual([]);
  });
});

// The intro line is shown while active and left out once cancelled (issue 139, below): a choice, checked by its key.
describe("AC8 (issue 137) — the intro line", () => {
  it("AC8: an active subscription's page shows the intro line", async () => {
    await subscribedAda();
    expect(textsOf((await render()).html)).toContain(t("account.weeks.intro"));
  });
});

// Issue 138: the meal card, between the Notice and the weeks card. Which week a switch starts from is switchWeek's
// (src/switch-meal.test.ts) and what a save does ./actions.test.ts's; here each of the card's states goes through the
// page once. Ada signs up for 3–4 people and Standard at a stored $45 a week; her switch week is February 14, the
// first listed week whose cutoff has not passed. The card is read by its picks, price, week and links.
describe("issue 138 — the meal card", () => {
  const FEB_7 = "2027-02-07";
  const FEB_14 = "2027-02-14";

  /** Each option type's id → the id of its option named in `names`. */
  const choiceOf = (names: string[]): Record<string, string> =>
    Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options.find((option) => names.includes(option.name))?.id ?? "no such option"]));

  /** The meal card's visible text, as one string. */
  const textOf = (card: string): string => textsOf(card).join(" ");

  /** The page drawn with `query`, and the meal card's markup: the first Card, which is a <section>. */
  const renderCard = async (query: { switch?: string } = {}): Promise<{ html: string; card: string }> => {
    const html = renderToStaticMarkup(await UpcomingWeeks({ searchParams: Promise.resolve(query) }));
    const sections = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => match[1] ?? "");
    // The meal card is the one before the weeks card, which holds the list.
    return { html, card: sections.find((section) => !section.includes("<li")) ?? "" };
  };

  /** Where each link in `html` goes, as a path and query. */
  const linksOf = (html: string): string[] =>
    attributesOf(html, "a").map((link) => {
      const url = new URL(link.href ?? "", "http://haul.test/account/weeks");
      return `${url.pathname}${url.search}`;
    });

  it("AC5: closed, the card shows the meal and its weekly price, and Switch size or menu, a link to ?switch=1", async () => {
    await subscribedAda();
    const { card } = await renderCard();
    expect(textOf(card)).toContain("3–4 people · Standard");
    expect(textOf(card)).toContain(formatUsdWhole(4500));
    expect(linksOf(card)).toEqual(["/account/weeks?switch=1"]);
  });

  it("AC5: after a switch whose picks have not started, the card shows the new meal and price, and the week they start from", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.switchPicks(subscriptionId, choiceOf(["2 people", "Vegan"]), MAR_7, 5000);
    const { card } = await renderCard();
    for (const value of ["2 people · Vegan", formatUsdWhole(5000), titleOf(MAR_7)]) expect(textOf(card)).toContain(value);
  });

  it("AC5: picks that started with the first listed week have no From line: they are the meal now", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.switchPicks(subscriptionId, choiceOf(["2 people", "Vegan"]), FEB_7, 5000);
    const { card } = await renderCard();
    for (const value of ["2 people · Vegan", formatUsdWhole(5000)]) expect(textOf(card)).toContain(value);
    for (const weekOf of [FEB_7, MAR_7]) expect(textOf(card)).not.toContain(titleOf(weekOf));
  });

  it("AC3: open at ?switch=1, the card is a form posting the switch week to switchMeal, with the newest picks selected, the week it applies from, one submit and Cancel back to the page", async () => {
    const subscriptionId = await subscribedAda();
    const newest = choiceOf(["2 people", "Vegan"]);
    await services.repo.switchPicks(subscriptionId, newest, MAR_7, 5000);
    const { card } = await renderCard({ switch: "1" });

    const forms = [...card.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)];
    expect(forms).toHaveLength(1);
    const [, attrs = "", inner = ""] = forms[0] ?? [];
    const inputs = attributesOf(inner, "input");
    const buttons = attributesOf(inner, "button");
    const action = buttons.find((button) => button.formaction !== undefined)?.formaction ?? attributesOf(`<form${attrs}>`, "form")[0]?.action;
    expect(action).toBe("switchMeal");
    expect(inputs.find((input) => input.name === "week")).toMatchObject({ type: "hidden", value: FEB_14 });
    const checked = Object.fromEntries(inputs.filter((input) => input.type === "radio" && "checked" in input).map((input) => [input.name, input.value]));
    expect(checked).toEqual(newest);

    expect(textOf(inner)).toContain(titleOf(FEB_14));
    expect(buttons.filter((button) => button.type === "submit")).toHaveLength(1);
    expect(linksOf(card)).toEqual(["/account/weeks"]);
  });

  it("AC5: with no switch week listed, the card stays closed with no Switch size or menu, even at ?switch=1", async () => {
    // Every listed week paid: none is coming, skipped, or closed with no charge.
    const subscriptionId = await subscribedAda();
    for (const weekOf of sundaysFrom(FEB_7, 12)) await services.repo.addLedgerRow(subscriptionId, weekOf, "paid", 4500);
    for (const query of [{}, { switch: "1" }]) {
      const { card } = await renderCard(query);
      expect(textOf(card)).toContain("3–4 people · Standard");
      expect(textOf(card)).toContain(formatUsdWhole(4500));
      expect(linksOf(card)).toEqual([]);
      expect(card).not.toContain("<form");
    }
  });
});

// Issue 139: a cancelled subscription's Upcoming weeks. That only paid rows stay, with no button, is upcomingRows'
// (src/account-weeks.test.ts); here one case goes through the page.
describe("AC5 (issue 139) — Upcoming weeks after a cancel", () => {
  it("AC5: only the paid weeks to come are listed, with no Skip or Unskip, and the meal card has no Switch size or menu, even at ?switch=1", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, "2027-02-07", "paid", 4500);
    await services.repo.addLedgerRow(subscriptionId, "2027-03-07", "paid", 4500);
    await services.repo.skipWeek(subscriptionId, "2027-02-28");
    await services.repo.cancelSubscription(subscriptionId, NOW);
    for (const query of [{}, { switch: "1" }]) {
      const html = renderToStaticMarkup(await UpcomingWeeks({ searchParams: Promise.resolve(query) }));
      const rows = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textsOf(match[1] ?? ""));
      expect(rows.map((row) => row[0])).toEqual([titleOf("2027-02-07"), titleOf("2027-03-07")]);
      // A paid week: Paid, as its line and its badge.
      expect(rows[0]).toEqual([titleOf("2027-02-07"), t("account.marker.paid"), t("account.marker.paid")]);
      expect(html).not.toContain("<form");
      expect(attributesOf(html, "a").map((link) => link.href)).not.toContain("/account/weeks?switch=1");
    }
  });

  // Review route (@ui-reviewer): nothing more is charged, so neither the intro line, which says when a week is
  // charged, nor the meal card's weekly price is shown.

  /** Ada's subscription with February 7 paid, cancelled now; the page's markup. */
  const renderCancelled = async (): Promise<string> => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, "2027-02-07", "paid", 4500);
    await services.repo.cancelSubscription(subscriptionId, NOW);
    return renderToStaticMarkup(await UpcomingWeeks({ searchParams: Promise.resolve({}) }));
  };

  it("AC5: the intro line, which says when a week is charged, is not shown", async () => {
    expect(textsOf(await renderCancelled())).not.toContain(t("account.weeks.intro"));
  });

  it("AC5: the meal card shows the meal without its weekly price", async () => {
    const html = await renderCancelled();
    // The meal card is the Card (a <section>) before the weeks card, which holds the list.
    const card = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => match[1] ?? "").find((section) => !section.includes("<li")) ?? "";
    expect(textsOf(card).join(" ")).toContain("3–4 people · Standard");
    expect(textsOf(card).join(" ")).not.toContain(formatUsdWhole(4500));
  });
});

// Issue 198: a locked subscription's Upcoming weeks. Which week is Locked or Card declined, and that no week has a button
// and there is no switch week while locked, is upcomingRows' and switchWeek's (src/account-weeks.test.ts,
// src/switch-meal.test.ts); when the declined Notice names its week is account home's (app/account/page.test.ts). Here
// one locked case of each goes through the page, the unlocked ones being the tests above. A row's line and badge are read
// by their catalog lines and the badge's kind by what Badge draws for it; the Notice by its week, its button and where
// it sits.
describe("issue 198 — Upcoming weeks while locked", () => {
  const FEB_7 = "2027-02-07";
  const FEB_14 = "2027-02-14";

  /** Ada, signed in, subscribed from January 3, with March 7 skipped, then a declined row for `declinedOn`; her ids. */
  const lockedAda = async (declinedOn = FEB_7): Promise<{ memberId: string; subscriptionId: string }> => {
    const member = await ada();
    const rows = await signup(member, "2027-01-03");
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    await services.repo.skipWeek(rows.subscriptionId, MAR_7);
    await services.repo.addLedgerRow(rows.subscriptionId, declinedOn, "declined", 4500);
    signIn(member);
    return { memberId: member.id, subscriptionId: rows.subscriptionId };
  };

  /**
   * January 31 declined; the run at February 7's cutoff wrote February 7 a locked row; then, now, a card update paid
   * January 31. Nothing is declined any more.
   */
  const updatedAda = async (): Promise<void> => {
    const { memberId, subscriptionId } = await lockedAda("2027-01-31");
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "locked", 0);
    await payDeclinedWeek(services.repo, memberId, subscriptionId, NOW);
  };

  /** The page drawn with `query`: its markup, each row's runs, and the meal card's markup, the Card before the weeks card. */
  const renderLocked = async (query: { switch?: string } = {}): Promise<{ html: string; rows: string[][]; card: string }> => {
    const html = renderToStaticMarkup(await UpcomingWeeks({ searchParams: Promise.resolve(query) }));
    const rows = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textsOf(match[1] ?? ""));
    const card = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => match[1] ?? "").find((section) => !section.includes("<li")) ?? "";
    return { html, rows, card };
  };

  /** The markup of the row titled `title`. */
  const rowMarkup = (html: string, title: string): string =>
    [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1] ?? "").find((inner) => textsOf(inner)[0] === title) ?? "";

  /** What Badge draws for `kind` with the catalog line `key`. */
  const badgeOf = (kind: BadgeKind, key: MessageKey): string => renderToStaticMarkup(createElement(Badge, { kind, children: t(key) }));

  /** Where each link in `markup` goes, as a path and query. */
  const linksOf = (markup: string): string[] =>
    attributesOf(markup, "a").map((link) => {
      const url = new URL(link.href ?? "", "http://haul.test/account/weeks");
      return `${url.pathname}${url.search}`;
    });

  it("AC1: no listed week has a Skip or Unskip: the page has no form, though a Coming and a Skipped week are before their cutoffs", async () => {
    await lockedAda();
    const { html } = await renderLocked();
    expect(html).not.toContain("<form");
  });

  it("AC2: the meal card has no Switch size or menu, and ?switch=1 opens no pickers", async () => {
    await lockedAda();
    for (const query of [{}, { switch: "1" }]) {
      const { card } = await renderLocked(query);
      expect(textsOf(card).join(" ")).toContain("3–4 people · Standard");
      expect(linksOf(card)).not.toContain("/account/weeks?switch=1");
      expect(card).not.toContain("<form");
    }
  });

  it("AC5: the one Notice sits above the meal card, names the declined week whose pickup is to come, and ends with a primary Update your card to /account/card; the intro line is left out", async () => {
    await lockedAda();
    const { html } = await renderLocked();
    const alerts = alertTexts(html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(t("account.card.declinedWeek", { week: titleOf(FEB_7) }));
    const notice = /<(\w+)\b[^>]*\brole="alert"[^>]*>([\s\S]*?)<\/\1>/.exec(html)?.[2] ?? "";
    expect(notice).toContain(renderToStaticMarkup(createElement(Button, { kind: "primary", href: ACCOUNT_CARD_PATH, children: t("account.updateCard") })));
    expect(html.indexOf('role="alert"')).toBeGreaterThan(-1);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf("<section"));
    expect(textsOf(html)).not.toContain(t("account.weeks.intro"));
  });

  it("AC6: a week after the declined week is Locked: the no-pickup line, the Locked badge of the locked kind, no charge day and no button", async () => {
    await lockedAda();
    const { html, rows } = await renderLocked();
    expect(rowTitled(rows, titleOf(FEB_14))).toEqual([titleOf(FEB_14), t("account.noPickupLocked"), t("account.marker.locked")]);
    expect(rowMarkup(html, titleOf(FEB_14))).toContain(badgeOf("locked", "account.marker.locked"));
  });

  // Issue 217: a Locked week's line is picked by the lock. While locked it is the no-pickup line; once a card update has
  // paid the declined week, a week still holding a locked row (DEC-042) says why it has no meal. Which weeks are Locked
  // is upcomingRows' and unchanged; a week after the declined week, while locked, is issue 198's AC6 above.
  describe("issue 217 — a Locked week's line", () => {
    it("AC1: still locked, a week holding a locked row is Locked: the no-pickup line, the Locked badge of the locked kind, and no button", async () => {
      // January 31 declined, February 7 a locked row, and no card update: the subscription is still locked.
      const { subscriptionId } = await lockedAda("2027-01-31");
      await services.repo.addLedgerRow(subscriptionId, FEB_7, "locked", 0);
      const { html, rows } = await renderLocked();
      expect(rowTitled(rows, titleOf(FEB_7))).toEqual([titleOf(FEB_7), t("account.noPickupLocked"), t("account.marker.locked")]);
      expect(rowMarkup(html, titleOf(FEB_7))).toContain(badgeOf("locked", "account.marker.locked"));
      expect(formsIn(html, titleOf(FEB_7))).toEqual([]);
    });

    it("AC2: once a card update has paid the declined week, a week holding a locked row is Locked with the after-update line, the Locked badge of the locked kind, and no button", async () => {
      await updatedAda();
      const { html, rows } = await renderLocked();
      expect(rowTitled(rows, titleOf(FEB_7))).toEqual([titleOf(FEB_7), t("account.weeks.lockedAfterUpdate"), t("account.marker.locked")]);
      expect(rowMarkup(html, titleOf(FEB_7))).toContain(badgeOf("locked", "account.marker.locked"));
      expect(formsIn(html, titleOf(FEB_7))).toEqual([]);
    });
  });

  it("AC11: the declined week is Card declined, as account home's badge: its line, no charge day and no button", async () => {
    await lockedAda();
    const { html, rows } = await renderLocked();
    expect(rowTitled(rows, titleOf(FEB_7))).toEqual([titleOf(FEB_7), t("account.weeks.declined"), t(SUBSCRIPTION_BADGES.declined.key)]);
    expect(rowMarkup(html, titleOf(FEB_7))).toContain(badgeOf(SUBSCRIPTION_BADGES.declined.kind, SUBSCRIPTION_BADGES.declined.key));
  });

  it("AC11: closed by an admin, the declined week is Closed, and the subscription stays locked: the Notice still shows, and the next week is Locked", async () => {
    await lockedAda();
    await close(FEB_7);
    const { html, rows } = await renderLocked();
    expect(rowTitled(rows, titleOf(FEB_7))).toEqual([titleOf(FEB_7), t("account.weeks.closedNoCharge"), t("account.marker.closed")]);
    expect(alertTexts(html)).toHaveLength(1);
    expect(rowTitled(rows, titleOf(FEB_14))).toEqual([titleOf(FEB_14), t("account.noPickupLocked"), t("account.marker.locked")]);
  });

  it("AC13: once a card update pays the declined week, it is Paid, as any paid week; guards AC11", async () => {
    const { memberId, subscriptionId } = await lockedAda();
    await payDeclinedWeek(services.repo, memberId, subscriptionId, NOW);
    const { rows } = await renderLocked();
    expect(rowTitled(rows, titleOf(FEB_7))).toEqual([titleOf(FEB_7), t("account.marker.paid"), t("account.marker.paid")]);
  });

  it("AC14: once a card update pays the declined week, a week with no locked row has Skip again, Switch size or menu is back, and there is no Notice; guards AC1, AC2 and AC5", async () => {
    await updatedAda();
    const { html, card } = await renderLocked();
    expect(formsIn(html, titleOf(FEB_14))).toEqual([{ action: "skipWeek", week: FEB_14 }]);
    expect(linksOf(card)).toEqual(["/account/weeks?switch=1"]);
    expect(alertTexts(html)).toEqual([]);
  });
});
