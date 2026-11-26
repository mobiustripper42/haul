// Issue 136: the account home, `await Account()` with `next/headers` faked and the composition root mocked, as
// app/admin/page.test.ts renders /admin. A signed-in request is an ocf_session cookie for a member in an
// InMemoryRepository; a subscription is the rows a paid signup leaves. Read as the markup's text. Who counts as
// signed in is app/session.test.ts's (requireMember); which subscription is found is findSignupConfirmation's; which
// week is next is nextPickup's (src/pickup-week.test.ts), so here one week of each kind is read through the page.
// The header is faked, so what is read of it is the call the page makes; its buttons are app/site-header.test.ts's.
// The page is read by the values it shows, its badge's kind, its links, forms and Notices, and the key of a line shown
// in some states and not others (issue 211), never its words.
//
// Issue 219: /account is one page, Your account: the Supper Club card (the first Card, a `<section>`), with Switch from
// Upcoming weeks (issue 138's tests moved here), and below it Your details, the form and code step from /account/details
// (issue 156's page tests moved here). Each form's action stands in for a server reference: React writes what
// `$$FORM_ACTION` gives as the form's `action`, so the markup names the action a form posts to. What the actions do is
// ./details-actions.test.ts's and ./weeks/actions.test.ts's; the code step's own parts app/sign-in/code-step.test.ts's.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator, pluralKey, type Language, type MessageKey } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { formatUsdWhole } from "@core/money.js";
import { pickupWeek, pickupWhereLine, weekTitle, type ChangedWeek } from "@core/pickup-week.js";
import type { Card } from "@core/ports/payments.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { hashCode } from "@core/sign-in/code.js";
import { signSession } from "@core/sign-in/session.js";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ButtonRow } from "../../components/ui/button-row";
import { Card as CardBox } from "../../components/ui/card";
import { Hint } from "../../components/ui/hint";
import { Notice } from "../../components/ui/notice";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, attributesOf, findAll, redirectOf, screenMarkup, sentencesOf, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import { SUBSCRIPTION_BADGES } from "../subscription-badges";
import { addSupperClub } from "../admin/subscribers-fixture";
import { payDeclinedWeek } from "./declined-fixture";
import { keepOldEmail } from "./details-actions";
import Account from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
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
  getEmail: () => {
    throw new Error("/account has no reason to send email");
  },
  getPayments: () => {
    throw new Error("/account has no reason to reach Square");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));
vi.mock("./details-actions", () => {
  const action = (name: string) => Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: `$ACTION_ID_${name}`, action: name }) });
  return {
    saveDetails: action("saveDetails"),
    confirmEmailChange: action("confirmEmailChange"),
    resendEmailChange: action("resendEmailChange"),
    keepOldEmail: action("keepOldEmail"),
  };
});
vi.mock("./weeks/actions", () => {
  const action = (name: string) => Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: `$ACTION_ID_${name}`, action: name }) });
  return { skipWeek: action("skipWeek"), unskipWeek: action("unskipWeek"), switchMeal: action("switchMeal") };
});

// Wednesday, February 3, noon in Cleveland. The calendar lists from the week of February 7 (its cutoff, the end of
// Monday, February 1, passed; its pickup to come), then February 14, and on: 12 weeks, to April 25.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const FEB_7 = "2027-02-07";
const FEB_14 = "2027-02-14";
const MAR_7 = "2027-03-07";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
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

/** Ada, through Create Account, with the details given. */
const ada = (over: Partial<{ firstName: string; lastName: string; phone: string; language: Language }> = {}): Promise<Member> =>
  services.repo.saveAccount({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "(216) 555-0134", language: "en", ...over });

/**
 * The member's signup rows for `picks` and `firstWeek`, pending. The weekly price is 4500 whatever the picks: "2
 * people" is 5000 and every menu 0, so a page reading the picks' price would show $50 where the stored price is $45.
 */
const signup = (member: Member, { picks = ["2 people", "Standard"], firstWeek = "2027-01-03" } = {}): Promise<PendingSignup> =>
  services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(
      product.optionTypes.map((type) => [type.id, type.options.find((option) => picks.includes(option.name))?.id ?? "no such option"]),
    ),
    firstChargeCents: 4500,
    weeklyCents: 4500,
    pickupDate: firstWeek,
    consentText: "I agree to a weekly charge of $45.",
    consentAt: new Date("2026-12-01T17:00:00.000Z"),
  });

/** The card Square saved, on file from the signup's confirm (issue 254). */
const CARD: Card = { id: "ccof:card-1", brand: "VISA", last4: "1111", expMonth: 12, expYear: 2030 };

/** An active subscription: the signup's first charge paid, with a card on file. */
const subscribed = async (member: Member, options?: Parameters<typeof signup>[1]): Promise<void> => {
  const rows = await signup(member, options);
  await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"), CARD);
};

/** Ada, signed in, with an active subscription paid for January 3 and a card on file; her member and its id. */
const activeAda = async (options?: Parameters<typeof signup>[1]): Promise<{ member: Member; subscriptionId: string }> => {
  const member = await ada();
  const rows = await signup(member, options);
  await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"), CARD);
  signIn(member);
  return { member, subscriptionId: rows.subscriptionId };
};

/** Each option type's id → the id of its option named in `names`. */
const choiceOf = (names: string[]): Record<string, string> =>
  Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options.find((option) => names.includes(option.name))?.id ?? "no such option"]));

const change = (weekOf: string, over: Partial<ChangedWeek>) =>
  services.repo.savePickupWeek(product.id, { weekOf, closedAt: null, note: null, firstDay: null, lastDay: null, ...over });
const close = (weekOf: string) => change(weekOf, { closedAt: new Date("2027-01-20T15:00:00.000Z") });

/** The page's query (issue 219): Switch's and Your details'. */
type Query = { switch?: string; switchError?: string; saved?: string; error?: string; sent?: string; limited?: string };

/** The markup of each Card (a `<section>`), in order: the Supper Club card first, then Your details or the code step. */
const sectionsOf = (html: string): string[] => [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => match[1] ?? "");

/**
 * The page drawn with `query`, or called with no props when none is given: its tree, markup, runs of text, all of it
 * as one line, the meal card's badge kind and text, how many Notices it shows, and its Cards' markup.
 */
const render = async (query?: Query) => {
  const element = (query === undefined ? await Account() : await Account({ searchParams: Promise.resolve(query) })) as ReactElement;
  const html = renderToStaticMarkup(element);
  const runs = textsOf(html);
  const badge = findAll(element, Badge)[0]?.props;
  return { element, html, runs, text: runs.join(" "), badge: badge?.kind, badgeText: badge?.children, notices: findAll(element, Notice).length, sections: sectionsOf(html) };
};

/** The page's text holds none of the listed weeks' titles: no next pickup is named. */
const namesNoWeek = (text: string): boolean => [FEB_7, FEB_14].every((weekOf) => !text.includes(titleOf(weekOf)));

/** The title of the week of `weekOf` as the page's language writes it, with its row's days. */
const titleOf = (weekOf: string, changed: ChangedWeek | null = null): string => weekTitle(t, pickupWeek(weekOf, changed), "en");

/** The page's two columns, left first: each outermost div holding exactly one Card. */
const columnsOf = (element: ReactElement): ReactElement[] => {
  const single = findAll(element, "div").filter((div) => findAll(div, CardBox).length === 1);
  return single.filter((div) => !single.some((outer) => outer !== div && findAll(outer, "div").includes(div)));
};

/** Which of a Notice and a Card a column holds, in order. */
const orderIn = (column: ReactElement | undefined) => [...renderToStaticMarkup(column).matchAll(/role="alert"|<section\b/g)].map(([mark]) => mark);

/** Where each link in `markup` goes, as a path and query. */
const linksOf = (markup: string): string[] =>
  attributesOf(markup, "a").map((link) => {
    const url = new URL(link.href ?? "", "http://haul.test/account");
    return `${url.pathname}${url.search}`;
  });

/** Each form in `markup`, in order: the action it posts to, and its inner markup. */
const formsOf = (markup: string): { action: string; inner: string }[] =>
  [...markup.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, attrs = "", inner = ""]) => {
    const buttons = attributesOf(inner, "button");
    const action = buttons.find((button) => button.formaction !== undefined)?.formaction ?? attributesOf(`<form${attrs}>`, "form")[0]?.action ?? "";
    return { action, inner };
  });

/** The action each form in `markup` posts to, in order. */
const actionsOf = (markup: string): string[] => formsOf(markup).map((form) => form.action);

/** Issue 219: the pending-switch line for the newer set `meal` starting the week of `weekOf`, by its catalog line. */
const pendingLine = (meal: string, weekOf: string): string => t("account.pendingSwitch", { meal, week: titleOf(weekOf) });

describe("AC1 (issue 136) — /account, signed out", () => {
  it("AC1: a signed-out visitor is redirected to /sign-in", async () => {
    await expect(redirectOf(Account())).resolves.toBe("/sign-in");
  });
});

// Issue 260: a member who never joined stays on the page. Who counts as never joined is requireAccount's
// (./subscriber.test.ts), so here it is one with no subscription; what the Notice is is noSupperClubNotice's
// (./no-supper-club-notice.test.ts), so here it is read by its lead's catalog line. Which Notice shows, or none, is a choice.
describe("AC4 (issue 260) — /account, a member who never joined", () => {
  const NEVER_JOINED = t("account.noSupperClub");

  /** Ada, signed in, with no subscription. */
  const neverAda = async (): Promise<Member> => {
    const member = await ada();
    signIn(member);
    return member;
  };

  /** The page drawn with `query`, sending nobody anywhere. */
  const stays = async (query: Query = {}) => {
    await expect(Account({ searchParams: Promise.resolve(query) })).resolves.toBeDefined();
    return render(query);
  };

  const pending = (member: Member) =>
    services.repo.startEmailChange({ memberId: member.id, newEmail: "ada.new@example.com", codeHash: hashCode("123456"), now: new Date(NOW.getTime() - MINUTE) });

  it("AC4: the page renders, and the left column, the first, holds the one Notice, the never-joined one, and no card", async () => {
    await neverAda();
    const { element, html } = await stays();
    expect(findAll(element, Notice).map(({ props }) => props.lead)).toEqual([NEVER_JOINED]);
    expect(orderIn(element)).toEqual(['role="alert"', "<section"]);
    // The Notice and the page's one card are each in a column of their own.
    const holding = (notices: number, cards: number) => findAll(element, "div").filter((div) => findAll(div, Notice).length === notices && findAll(div, CardBox).length === cards);
    expect(holding(1, 0)).not.toEqual([]);
    expect(holding(0, 1)).not.toEqual([]);
    expect(alertTexts(html)).toHaveLength(1);
  });

  it("AC4: there is no Supper Club card: no badge, no Switch, no Update your card and no Cancel; the one link in the columns is the Notice's", async () => {
    await neverAda();
    const { element, html } = await stays();
    expect(findAll(element, CardBox)).toHaveLength(1);
    expect(findAll(element, Badge)).toEqual([]);
    expect(linksOf(html)).toEqual(["/supper-club"]);
    expect(actionsOf(html)).toEqual(["saveDetails"]);
  });

  // Your details is read against the same member's page once they have subscribed: the subscriber's own tests are below.
  it.each<[string, Query, boolean]>([
    ["no query", {}, false],
    ["saved=1", { saved: "1" }, false],
    ["limited=5", { limited: "5" }, false],
    ["error=firstName", { error: "firstName" }, false],
    ["no query and an email change pending", {}, true],
    ["sent=1 and an email change pending", { sent: "1" }, true],
    ["error=invalid and an email change pending", { error: "invalid" }, true],
  ])("AC4: with %s, Your details, and the Notices beside the never-joined one, are a subscriber's", async (_what, query, changing) => {
    const member = await neverAda();
    if (changing) await pending(member);
    const never = await stays(query);
    await subscribed(member);
    const subscriber = await render(query);
    const icons = (element: ReactElement) => findAll(element, Notice).filter((notice) => notice.props.lead !== NEVER_JOINED).map((notice) => notice.props.icon);
    expect(never.sections).toEqual([subscriber.sections[1]]);
    expect(icons(never.element)).toEqual(icons(subscriber.element));
    expect(findAll(never.element, Notice)).toHaveLength(findAll(subscriber.element, Notice).length + 1);
  });

  it.each<[string, Query]>([
    ["switch=1", { switch: "1" }],
    ["switchError=cutoff", { switchError: "cutoff" }],
  ])("AC4: %s draws nothing: the page is the page with no query", async (_what, query) => {
    await neverAda();
    expect((await stays(query)).html).toBe((await stays()).html);
  });
});

describe("AC3 (issue 136) — the subscription's picks and weekly price", () => {
  it('AC3: the picks are the option names in option-type position order, joined with " · "', async () => {
    const member = await ada();
    await subscribed(member, { picks: ["Vegan", "2 people"] });
    signIn(member);
    expect((await render()).runs).toContain("2 people · Vegan");
  });

  it("AC3: the charge line names the subscription's stored weekly price, formatted whole, not the price of its picks", async () => {
    const member = await ada();
    await subscribed(member);
    signIn(member);
    const { text } = await render();
    expect(text).toContain(formatUsdWhole(4500));
    expect(text).not.toContain(formatUsdWhole(5000));
  });
});

// Issue 138: the newest set is findSignupConfirmation's (src/adapters/signup-contract.ts), and issue 219 the set in effect
// for a week findOptionsForWeek's (src/adapters/week-credit-contract.ts); here the page shows them once.
describe("AC5 (issue 138) — after a switch", () => {
  it("AC5: the page shows the picks in effect for the next pickup (issue 219, AC4) and the new weekly price, though the new picks start at a week to come", async () => {
    const member = await ada();
    await subscribed(member);
    signIn(member);
    const confirmation = await services.repo.findSignupConfirmation(member.id, product.id);
    const vegan = Object.fromEntries(
      product.optionTypes.map((type) => [type.id, type.options.find((option) => ["3–4 people", "Vegan"].includes(option.name))?.id ?? "no such option"]),
    );
    await services.repo.switchPicks(confirmation?.subscriptionId ?? "no subscription", vegan, "2027-03-07", 8000);
    const { runs, text } = await render();
    expect(runs).toContain("2 people · Standard");
    expect(text).toContain(formatUsdWhole(8000));
  });
});

describe("AC3b (issue 136) — the next pickup", () => {
  // The where line is pickupWhereLine's (src/pickup-week.test.ts).
  it("AC3b: for a member whose first week is past, the next pickup is the first listed week, February 7", async () => {
    const member = await ada();
    await subscribed(member);
    signIn(member);
    const { text } = await render();
    expect(text).toContain(titleOf(FEB_7));
    expect(text).not.toContain(titleOf(FEB_14));
  });

  it("AC3b: a member who joined after a cutoff sees their first week, February 14, not the listed week before it", async () => {
    const member = await ada();
    await subscribed(member, { firstWeek: FEB_14 });
    signIn(member);
    const { text } = await render();
    expect(text).toContain(titleOf(FEB_14));
    expect(text).not.toContain(titleOf(FEB_7));
  });

  it("AC3b: a moved next week names its days, in its title and in the where line", async () => {
    const moved: ChangedWeek = { weekOf: FEB_7, closedAt: null, note: null, firstDay: "2027-02-06", lastDay: FEB_7 };
    await change(FEB_7, moved);
    const member = await ada();
    await subscribed(member);
    signIn(member);
    const { runs, text } = await render();
    expect(text).toContain(titleOf(FEB_7, moved));
    expect(runs).toContain(pickupWhereLine(t, pickupWeek(FEB_7, moved), "en"));
  });

  it("AC3b: on a closed week's own Monday pickup day the week is still seen as closed, and passed over to the week after", async () => {
    vi.setSystemTime(new Date("2027-02-08T17:00:00.000Z"));
    await close(FEB_7);
    const member = await ada();
    await subscribed(member);
    signIn(member);
    const { text } = await render();
    expect(text).toContain(titleOf(FEB_14));
    expect(text).not.toContain(titleOf(FEB_7));
  });

});

// Issue 202: which week is next, skips and the walk past any list included, is nextPickup's and weeksFrom's
// (src/pickup-week.test.ts); here one skipped week goes through loadNextPickup and the page.
describe("AC2 (issue 202) — the next pickup passes over a skipped week", () => {
  it("AC2: with February 7 skipped, Next pickup names February 14", async () => {
    const member = await ada();
    const rows = await signup(member);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    await services.repo.skipWeek(rows.subscriptionId, FEB_7);
    signIn(member);
    const { text } = await render();
    expect(text).toContain(titleOf(FEB_14));
    expect(text).not.toContain(titleOf(FEB_7));
  });
});

// Issue 196: the next-pickup line while locked. Which week is next while locked is nextPickup's
// (src/pickup-week.test.ts) and which week is declined findMemberSubscription's (src/adapters/charge-run-contract.ts);
// here one locked and one unlocked case through the page. The no-pickup line is shown only while locked: a choice,
// checked by its key.
describe("AC8 (issue 196) — the next pickup while locked", () => {
  const NO_PICKUP = t("account.noPickupLocked");

  /** Ada, signed in, with an active subscription paid for January 3 and a declined row for `declinedOn`; its id. */
  const declinedAda = async (declinedOn: string): Promise<string> => {
    const member = await ada();
    const rows = await signup(member);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    await services.repo.addLedgerRow(rows.subscriptionId, declinedOn, "declined", 4500);
    signIn(member);
    return rows.subscriptionId;
  };

  it("AC8: once the declined week's pickup has passed, Next pickup and its where line are replaced by one line, not a Notice; the charge line is not shown (issue 198, AC15)", async () => {
    await declinedAda("2027-01-31");
    const { html, runs, text, notices } = await render();
    expect(namesNoWeek(text)).toBe(true);
    expect(runs).toContain(NO_PICKUP);
    expect(runs).not.toContain(t("supperClub.next.charge", { price: formatUsdWhole(4500) }));
    // Issue 145: the declined Notice is the page's only one, and the no-pickup line is in none.
    expect(notices).toBe(1);
    expect(alertTexts(html).some((alert) => alert.includes(NO_PICKUP))).toBe(false);
  });

  it("AC8: while the declined week's pickup is still to come, Next pickup names it, and the no-pickup line is not shown", async () => {
    await declinedAda(FEB_7);
    const { runs, text } = await render();
    expect(text).toContain(titleOf(FEB_7));
    expect(runs).not.toContain(NO_PICKUP);
  });

  it("AC8 [code]: a cancelled subscription holding a declined row shows the cancelled card as today, with no no-pickup line", async () => {
    const subscriptionId = await declinedAda("2027-01-31");
    await services.repo.cancelSubscription(subscriptionId, NOW);
    const { html, runs } = await render();
    expect(alertTexts(html)).toHaveLength(1);
    expect(runs).not.toContain(NO_PICKUP);
  });
});

describe("AC5 (issue 136) — the header on /account", () => {
  it('AC5: the page opens with the site header, Your account marked current: current "account"', async () => {
    const member = await ada();
    await subscribed(member);
    signIn(member);
    await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "account" }));
  });
});

// Issue 139: account home after a cancel. Who is let in is requireAccount's (app/account/subscriber.test.ts) and
// which week is the last pickup lastPickup's (src/account-weeks.test.ts); here each of the Notice's three pickup
// cases goes through the page once, by the week it names and, for is or was, the key of the line it picks.
describe("issue 139 — account home, cancelled and not", () => {
  /** Ada, signed in, with an active subscription paid for January 3; its id. */
  const subscribedAda = async (options?: Parameters<typeof signup>[1]): Promise<string> => {
    const member = await ada();
    const rows = await signup(member, options);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    signIn(member);
    return rows.subscriptionId;
  };

  const cancel = (subscriptionId: string) => services.repo.cancelSubscription(subscriptionId, NOW);

  /** Where each link on the page goes. */
  const hrefsOf = (html: string): string[] => attributesOf(html, "a").map((link) => link.href ?? "");

  it("AC5: with a paid week still to come, the one Notice names that week as the last pickup, which is to come", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "paid", 4500);
    await cancel(subscriptionId);
    const alerts = alertTexts((await render()).html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(titleOf(FEB_7));
    expect(alerts[0]).toContain(t("account.lastPickupIs", { week: titleOf(FEB_7) }));
  });

  it("AC5: once the last paid week has passed, the one Notice names it as the last pickup, which was", async () => {
    const subscriptionId = await subscribedAda();
    await cancel(subscriptionId);
    const alerts = alertTexts((await render()).html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(titleOf("2027-01-03"));
    expect(alerts[0]).toContain(t("account.lastPickupWas", { week: titleOf("2027-01-03") }));
  });

  it("AC5: with no paid week, the signup's week closed after it was paid, the Notice names no week", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.closePickupWeek(product.id, "2027-01-03", null, new Date("2027-01-03T16:00:00.000Z"));
    await cancel(subscriptionId);
    const alerts = alertTexts((await render()).html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).not.toContain(titleOf("2027-01-03"));
    expect(namesNoWeek(alerts[0] ?? "")).toBe(true);
  });

  it("AC5: the meal card shows the meal and a Cancelled badge, and no Next pickup, charge line or Cancel link; the details form is shown", async () => {
    const subscriptionId = await subscribedAda({ picks: ["2 people", "Vegan"] });
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "paid", 4500);
    await cancel(subscriptionId);
    const { html, runs, badge, badgeText } = await render();
    expect(runs).toContain("2 people · Vegan");
    expect(badge).toBe(SUBSCRIPTION_BADGES.cancelled.kind);
    expect(badgeText).toBe(t(SUBSCRIPTION_BADGES.cancelled.key));
    // The Notice names February 7 as the last pickup; the meal card names no week and no price.
    const mealCard = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => textsOf(match[1] ?? "").join(" "))[0] ?? "";
    expect(namesNoWeek(mealCard)).toBe(true);
    expect(mealCard).not.toContain(formatUsdWhole(4500));
    expect(hrefsOf(html)).not.toContain("/account/cancel");
    expect(actionsOf(html)).toContain("saveDetails");
  });

  it("AC7: after a cancel and a new signup, paid, the page shows the new subscription: its meal, the Active badge, no Notice", async () => {
    const first = await subscribedAda();
    expect(await cancel(first)).toBe(true);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const member = await services.repo.findMemberByEmail("ada@example.com");
    if (!member) throw new Error("Ada is gone");
    const again = await signup(member, { picks: ["2 people", "Vegan"] });
    await services.repo.confirmSignupRows(again.ledgerId, `PAYMENT_${again.ledgerId}`, again.amountCents, NOW, CARD);
    const { html, runs, badge, badgeText } = await render();
    expect(runs).toContain("2 people · Vegan");
    expect(badge).toBe(SUBSCRIPTION_BADGES.active.kind);
    expect(badgeText).toBe(t(SUBSCRIPTION_BADGES.active.key));
    expect(alertTexts(html)).toEqual([]);
  });
});

// Issue 145: account home with a declined card. Which rows are declined, and whether a row's week is closed, is the
// repository's (src/adapters/charge-run-contract.ts), and which week is next while locked is nextPickup's; here the
// page's own rule: the "is still made" sentence while the declined week's pickup is to come and its week is open. A
// declined row is the fake's addLedgerRow seam, as a charge run's decline leaves it; with the lock (issue 196) there is
// one. Read by the Notice, the week it names, its link and the badge's kind.
describe("issue 145 — AC1, AC13: account home with a declined card", () => {
  const JAN_31 = "2027-01-31";

  /** Ada, signed in, with an active subscription paid for January 3; its id. */
  const subscribedAda = async (): Promise<string> => {
    const member = await ada();
    const rows = await signup(member);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    signIn(member);
    return rows.subscriptionId;
  };

  const declined = (subscriptionId: string, weekOf: string) => services.repo.addLedgerRow(subscriptionId, weekOf, "declined", 4500);

  /** Where each link on the page goes. */
  const hrefsOf = (html: string): string[] => attributesOf(html, "a").map((link) => link.href ?? "");

  it("AC1: an active subscription holding a declined row whose pickup is to come: the one Notice names that week, Update your card goes to /account/card, and the badge is Card declined's, not Active's", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, FEB_7);
    const { html, badge, badgeText } = await render();
    const alerts = alertTexts(html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(titleOf(FEB_7));
    expect(hrefsOf(html)).toContain("/account/card");
    expect(badge).toBe(SUBSCRIPTION_BADGES.declined.kind);
    expect(badgeText).toBe(t(SUBSCRIPTION_BADGES.declined.key));
  });

  it("AC1: once the declined week's pickup has passed, the one Notice names no week; the button and badge stay", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, JAN_31);
    const { html, badge, badgeText } = await render();
    const alerts = alertTexts(html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).not.toContain(titleOf(JAN_31));
    expect(hrefsOf(html)).toContain("/account/card");
    expect(badge).toBe(SUBSCRIPTION_BADGES.declined.kind);
    expect(badgeText).toBe(t(SUBSCRIPTION_BADGES.declined.key));
  });

  it("AC13: when the declined row's week was closed, the Notice names no week, though its pickup is to come; the badge is still Card declined's", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, FEB_7);
    await close(FEB_7);
    const { html, badge, badgeText } = await render();
    const alerts = alertTexts(html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).not.toContain(titleOf(FEB_7));
    expect(badge).toBe(SUBSCRIPTION_BADGES.declined.kind);
    expect(badgeText).toBe(t(SUBSCRIPTION_BADGES.declined.key));
  });

  it("AC1: a cancelled subscription holding a declined row keeps the cancelled Notice and the Cancelled badge, and no declined Notice", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, JAN_31);
    await services.repo.cancelSubscription(subscriptionId, NOW);
    const { html, badge, badgeText } = await render();
    expect(alertTexts(html)).toHaveLength(1);
    expect(badge).toBe(SUBSCRIPTION_BADGES.cancelled.kind);
    expect(badgeText).toBe(t(SUBSCRIPTION_BADGES.cancelled.key));
    expect(hrefsOf(html)).not.toContain("/account/card");
  });
});

// Issue 198: the charge line while locked. Whether a subscription is locked is lockedWeek's (src/account-weeks.test.ts);
// here one locked and one unlocked case through the page. The charge line is shown in some states and not others: a
// choice, checked by its key. Unlike the no-pickup line (issue 196, above), it goes as soon as the subscription holds a
// declined row, while the declined week's pickup is still to come.
describe("AC15 (issue 198) — the charge line while locked", () => {
  const CHARGE_LINE = t("supperClub.next.charge", { price: formatUsdWhole(4500) });

  /** Ada, signed in, with an active subscription paid for January 3 and a declined row for February 7, its pickup to come; her ids. */
  const lockedAda = async (): Promise<{ memberId: string; subscriptionId: string }> => {
    const member = await ada();
    const rows = await signup(member);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    await services.repo.addLedgerRow(rows.subscriptionId, FEB_7, "declined", 4500);
    signIn(member);
    return { memberId: member.id, subscriptionId: rows.subscriptionId };
  };

  it("AC15: while locked, the charge line is not shown, though the declined week's pickup is still to come and Next pickup names it", async () => {
    await lockedAda();
    const { runs, text } = await render();
    expect(text).toContain(titleOf(FEB_7));
    expect(runs).not.toContain(CHARGE_LINE);
  });

  it("AC15: once a card update pays the declined week, the charge line is shown again; guards the case above", async () => {
    const { memberId, subscriptionId } = await lockedAda();
    await payDeclinedWeek(services.repo, memberId, subscriptionId, NOW);
    expect((await render()).runs).toContain(CHARGE_LINE);
  });
});

// ---------------------------------------------------------------------------------------------
// Issue 138, moved from Upcoming weeks (issue 219): the meal card's Switch. Which week a switch starts from is
// switchWeek's (src/switch-meal.test.ts) and what a save does ./weeks/actions.test.ts's; here each of the card's states
// goes through the page once. Ada signs up for 3–4 people and Standard at a stored $45 a week; her switch week is
// February 14, the first listed week whose cutoff has not passed. The card is read by its picks, price, week and links.
describe("issue 138 — the meal card's Switch, on /account", () => {
  const weeksAda = () => activeAda({ picks: ["3–4 people", "Standard"] });

  /** The card's visible text, as one string. */
  const textOf = (card: string): string => textsOf(card).join(" ");

  /** The page drawn with `query`, and the meal card's markup: the first Card. */
  const renderCard = async (query: { switch?: string } = {}): Promise<{ html: string; card: string }> => {
    const { html, sections } = await render(query);
    return { html, card: sections[0] ?? "" };
  };

  it("AC5: closed, the card shows the meal and its weekly price, and Switch size or menu, a link to ?switch=1", async () => {
    await weeksAda();
    const { card } = await renderCard();
    expect(textOf(card)).toContain("3–4 people · Standard");
    expect(textOf(card)).toContain(formatUsdWhole(4500));
    expect(linksOf(card)).toContain("/account?switch=1");
  });

  it("AC5: after a switch whose picks have not started, the card shows the new meal and price, and the week they start from", async () => {
    const { subscriptionId } = await weeksAda();
    await services.repo.switchPicks(subscriptionId, choiceOf(["2 people", "Vegan"]), MAR_7, 5000);
    const { card } = await renderCard();
    for (const value of ["2 people · Vegan", formatUsdWhole(5000), titleOf(MAR_7)]) expect(textOf(card)).toContain(value);
  });

  it("AC5: picks that start with the next pickup have no pending line: they are the meal now; guards issue 219's AC4", async () => {
    const { subscriptionId } = await weeksAda();
    await services.repo.switchPicks(subscriptionId, choiceOf(["2 people", "Vegan"]), FEB_7, 5000);
    const { card } = await renderCard();
    for (const value of ["2 people · Vegan", formatUsdWhole(5000)]) expect(textOf(card)).toContain(value);
    expect(sentencesOf(card)).not.toContain(pendingLine("2 people · Vegan", FEB_7));
    expect(textOf(card)).not.toContain(titleOf(MAR_7));
  });

  it("AC3: open at ?switch=1, the card is a form posting the switch week to switchMeal, with the newest picks selected, the week it applies from, one submit and Cancel back to the page", async () => {
    const { subscriptionId } = await weeksAda();
    const newest = choiceOf(["2 people", "Vegan"]);
    await services.repo.switchPicks(subscriptionId, newest, MAR_7, 5000);
    const { card } = await renderCard({ switch: "1" });

    const forms = formsOf(card);
    expect(forms.map((form) => form.action)).toEqual(["switchMeal"]);
    const inner = forms[0]?.inner ?? "";
    const inputs = attributesOf(inner, "input");
    const buttons = attributesOf(inner, "button");
    expect(inputs.find((input) => input.name === "week")).toMatchObject({ type: "hidden", value: FEB_14 });
    const checked = Object.fromEntries(inputs.filter((input) => input.type === "radio" && "checked" in input).map((input) => [input.name, input.value]));
    expect(checked).toEqual(newest);

    expect(textOf(inner)).toContain(titleOf(FEB_14));
    expect(buttons.filter((button) => button.type === "submit")).toHaveLength(1);
    expect(linksOf(inner)).toEqual(["/account"]);
  });

  it("AC5: with no switch week listed, the card stays closed with no Switch size or menu, even at ?switch=1", async () => {
    // Every listed week paid: none is coming, skipped, or closed with no charge.
    const { subscriptionId } = await weeksAda();
    for (const weekOf of sundaysFrom(FEB_7, 12)) await services.repo.addLedgerRow(subscriptionId, weekOf, "paid", 4500);
    for (const query of [{}, { switch: "1" }]) {
      const { card } = await renderCard(query);
      expect(textOf(card)).toContain("3–4 people · Standard");
      expect(textOf(card)).toContain(formatUsdWhole(4500));
      expect(linksOf(card)).not.toContain("/account?switch=1");
      expect(card).not.toContain("<form");
    }
  });
});

// Issue 198, moved from Upcoming weeks (issue 219): Switch while locked. That there is no switch week while locked is
// switchWeek's (src/switch-meal.test.ts); here one locked case and the card update that ends it go through the page.
describe("issue 198 — the meal card's Switch while locked, on /account", () => {
  /** Ada, signed in, subscribed from January 3 at 3–4 people and Standard, with March 7 skipped, then a declined row for `declinedOn`; her ids. */
  const lockedAda = async (declinedOn = FEB_7): Promise<{ memberId: string; subscriptionId: string }> => {
    const { member, subscriptionId } = await activeAda({ picks: ["3–4 people", "Standard"] });
    await services.repo.skipWeek(subscriptionId, MAR_7);
    await services.repo.addLedgerRow(subscriptionId, declinedOn, "declined", 4500);
    return { memberId: member.id, subscriptionId };
  };

  it("AC2: the meal card has no Switch size or menu, and ?switch=1 opens no pickers", async () => {
    await lockedAda();
    for (const query of [{}, { switch: "1" }]) {
      const card = (await render(query)).sections[0] ?? "";
      expect(textsOf(card).join(" ")).toContain("3–4 people · Standard");
      expect(linksOf(card)).not.toContain("/account?switch=1");
      expect(card).not.toContain("<form");
    }
  });

  it("AC14: once a card update pays the declined week, Switch size or menu is back; guards AC2", async () => {
    // January 31 declined; the run at February 7's cutoff wrote February 7 a locked row; then, now, a card update paid January 31.
    const { memberId, subscriptionId } = await lockedAda("2027-01-31");
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "locked", 0);
    await payDeclinedWeek(services.repo, memberId, subscriptionId, NOW);
    expect(linksOf((await render()).sections[0] ?? "")).toContain("/account?switch=1");
  });
});

// ---------------------------------------------------------------------------------------------
// Issue 219: one account page. The set in effect for a week is findOptionsForWeek's (src/adapters/week-credit-contract.ts),
// the switch week switchWeek's, and where each action lands its own test's; here the page's own rules.
describe("AC1 (issue 219) — the Supper Club card's controls", () => {
  it("AC1: an active member's one Supper Club card holds Switch size or menu to /account?switch=1, Cancel to /account/cancel, and Update your card to /account/card", async () => {
    await activeAda();
    const { html, sections } = await render();
    expect(linksOf(sections[0] ?? "").sort()).toEqual(["/account/cancel", "/account/card", "/account?switch=1"].sort());
    expect(linksOf(html).filter((link) => link === "/account/cancel")).toHaveLength(1);
  });
});

describe("AC2 (issue 219) — the pickers open in the card", () => {
  it("AC4 (issue 238): open, the pickers' form and its Cancel back to the page take the place of Switch, Update your card and Cancel the Supper Club, and all three are back once it closes", async () => {
    await activeAda();
    const card = (await render({ switch: "1" })).sections[0] ?? "";
    expect(actionsOf(card)).toEqual(["switchMeal"]);
    expect(linksOf(card)).toEqual(["/account"]);
    const closed = (await render()).sections[0] ?? "";
    expect(linksOf(closed).sort()).toEqual(["/account/cancel", "/account/card", "/account?switch=1"].sort());
  });

  it("AC2: at ?switch=1 with no switch week, the card shows the closed row: Cancel and Update your card, with no Switch and no form", async () => {
    const { subscriptionId } = await activeAda();
    for (const weekOf of sundaysFrom(FEB_7, 12)) await services.repo.addLedgerRow(subscriptionId, weekOf, "paid", 4500);
    const card = (await render({ switch: "1" })).sections[0] ?? "";
    expect(linksOf(card).sort()).toEqual(["/account/cancel", "/account/card"]);
    expect(actionsOf(card)).toEqual([]);
  });
});

// The cutoff Notice is shown on one value of switchError and not otherwise: a choice, checked by its catalog line.
describe("AC3 (issue 219) — the cutoff Notice on /account", () => {
  it("AC3: sent back with ?switchError=cutoff, the page shows the cutoff Notice, and no other", async () => {
    await activeAda();
    expect(alertTexts((await render({ switchError: "cutoff" })).html)).toEqual([t("account.weeks.cutoffPassed")]);
  });

  it("AC3: with no switchError, or another one, there is no Notice; guards the case above", async () => {
    await activeAda();
    for (const query of [{}, { switchError: "nope" }]) expect(alertTexts((await render(query)).html)).toEqual([]);
  });
});

// The pending line is shown in some states and not others: a choice, checked by its catalog line, with its values.
describe("AC4 (issue 219) — the meal for the next pickup, and a pending switch", () => {
  /** Ada at 2 people and Standard, with 3–4 people and Vegan from `fromWeek` on; her ids. */
  const switchedAda = async (fromWeek: string): Promise<{ member: Member; subscriptionId: string }> => {
    const found = await activeAda();
    await services.repo.switchPicks(found.subscriptionId, choiceOf(["3–4 people", "Vegan"]), fromWeek, 8000);
    return found;
  };

  it("AC4: a newer set starting after the next pickup, March 7, shows the pending line in the card, naming its meal and its start week", async () => {
    await switchedAda(MAR_7);
    const card = (await render()).sections[0] ?? "";
    expect(sentencesOf(card)).toContain(pendingLine("3–4 people · Vegan", MAR_7));
  });

  it("AC4: a newer set starting after every listed week shows no pending line, and the meal is the set in effect for the next pickup", async () => {
    const JUN_6 = "2027-06-06";
    await switchedAda(JUN_6);
    const { html, runs } = await render();
    expect(runs).toContain("2 people · Standard");
    expect(sentencesOf(html)).not.toContain(pendingLine("3–4 people · Vegan", JUN_6));
  });

  it.each([
    [
      "cancelled",
      async (subscriptionId: string) => {
        await services.repo.cancelSubscription(subscriptionId, NOW);
      },
    ],
    [
      "locked past the declined week",
      async (subscriptionId: string) => {
        await services.repo.addLedgerRow(subscriptionId, "2027-01-31", "declined", 4500);
      },
    ],
  ])("AC4: with no next pickup (%s), the meal stays the newest set and no pending line shows; guards the cases above", async (_what, arrange) => {
    const { subscriptionId } = await switchedAda(MAR_7);
    await arrange(subscriptionId);
    const { html, runs } = await render();
    expect(runs).toContain("3–4 people · Vegan");
    expect(sentencesOf(html)).not.toContain(pendingLine("3–4 people · Vegan", MAR_7));
  });
});

// The cancelled Notice is checked by its catalog line, the line it picks for a cancelled subscription.
describe("AC5 (issue 219) — a cancelled member's card", () => {
  it("AC5: the cancelled Notice shows, and the card has no Switch, Cancel or Update your card, even at ?switch=1; guards AC1", async () => {
    const { subscriptionId } = await activeAda();
    await services.repo.cancelSubscription(subscriptionId, NOW);
    for (const query of [{}, { switch: "1" }]) {
      const { html } = await render(query);
      const alerts = alertTexts(html);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain(t("account.cancelledNotice"));
      for (const link of ["/account?switch=1", "/account/cancel", "/account/card"]) expect(linksOf(html)).not.toContain(link);
      expect(actionsOf(html)).not.toContain("switchMeal");
    }
  });
});

describe("AC6 (issue 219) — Your details on /account", () => {
  it("AC6: below the Supper Club card, the details card holds the form posting to saveDetails", async () => {
    await activeAda();
    const { sections } = await render();
    expect(sections).toHaveLength(2);
    expect(textsOf(sections[0] ?? "")).toContain("2 people · Standard");
    expect(actionsOf(sections[0] ?? "")).toEqual([]);
    expect(actionsOf(sections[1] ?? "")).toEqual(["saveDetails"]);
  });

  it("AC6: while an email change is pending, the code step takes the details card's place, and the Supper Club card stays with its meal and Switch", async () => {
    const { member } = await activeAda();
    await services.repo.startEmailChange({ memberId: member.id, newEmail: "ada.new@example.com", codeHash: hashCode("123456"), now: new Date(NOW.getTime() - MINUTE) });
    const { sections } = await render();
    expect(sections).toHaveLength(2);
    expect(textsOf(sections[0] ?? "")).toContain("2 people · Standard");
    expect(linksOf(sections[0] ?? "")).toContain("/account?switch=1");
    expect(actionsOf(sections[1] ?? "")).toContain("confirmEmailChange");
    expect(actionsOf(sections[1] ?? "")).not.toContain("saveDetails");
  });

  it("AC6: with the code step showing, the page keeps one h1: the step's heading is level 2", async () => {
    const { member } = await activeAda();
    await services.repo.startEmailChange({ memberId: member.id, newEmail: "ada.new@example.com", codeHash: hashCode("123456"), now: new Date(NOW.getTime() - MINUTE) });
    const { html, sections } = await render();
    expect(actionsOf(sections[1] ?? "")).toContain("confirmEmailChange");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(sections[1]).toMatch(/<h2\b/);
  });
});

describe("AC8 (issue 219) — /account/details is gone", () => {
  it("AC8: app/account/details/ holds no page", () => {
    expect(existsSync(fileURLToPath(new URL("./details/page.tsx", import.meta.url)))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Issue 156, moved from /account/details (issue 219): Your details. The form and the code step share the page: the code
// step shows while the member has a pending change that has not expired. Who is let in is requireAccount's; what the
// forms do is ./details-actions.test.ts's; the code step's own parts are app/sign-in/code-step.test.ts's. Here each of
// the branches goes through once, by the forms, fields, notices and values it shows, a notice it picks by its catalog
// line, never its words (issue 211). The page's language is getLanguage's, app/language.test.ts's.
describe("issue 156 — Your details, on /account", () => {
  const OLD = "ada@example.com";
  const NEW = "ada.new@example.com";
  const DRAFT = "ocf_account_draft";
  /** Sign-in's wait line for 5 minutes: the page shows it only when sent back with limited=5. */
  const WAIT_5 = t(pluralKey("en", "signIn.limited", 5) as MessageKey, { minutes: 5 });

  /** Ada, through Create Account, confirmed, with an active Supper Club subscription and signed in; her email language is `language`. */
  const detailsAda = async (language: Language = "en"): Promise<Member> => {
    const member = await ada({ language });
    await services.repo.confirmMemberEmail(member.id, new Date("2026-12-01T17:00:00.000Z"));
    await subscribed(member);
    signIn(member);
    return member;
  };

  /** A change to `NEW` pending for the member, requested `ago` ms before now. */
  const pending = (member: Member, ago = MINUTE) =>
    services.repo.startEmailChange({ memberId: member.id, newEmail: NEW, codeHash: hashCode("123456"), now: new Date(NOW.getTime() - ago) });

  /** Each input's value, by name. */
  const valuesOf = (html: string): Record<string, string | undefined> =>
    Object.fromEntries(attributesOf(html, "input").map((input) => [input.name ?? "", input.value]));
  const selectedLanguages = (html: string) => attributesOf(html, "option").filter((option) => "selected" in option).map((option) => option.value);
  const noticeIcons = (element: ReactElement) => findAll(element, Notice).map((notice) => notice.props.icon);
  /** Where each of `marks` first appears in the markup, so a test can say one element comes before another. */
  const positions = (html: string, marks: readonly string[]) => marks.map((mark) => html.indexOf(mark));
  const ascending = (numbers: number[]) => numbers.every((n, i) => n >= 0 && (i === 0 || n > (numbers[i - 1] ?? -1)));
  /** The code step is showing: its code form is on the page. */
  const codeStepShows = (html: string) => actionsOf(html).includes("confirmEmailChange");

  describe("AC2 (issue 156) — the form opens filled", () => {
    it("AC2: first name, last name, email and phone hold the member's, and language for emails is theirs", async () => {
      await detailsAda("es");
      const { html } = await render({});
      expect(valuesOf(html)).toMatchObject({ firstName: "Ada", lastName: "Lovelace", email: OLD, phone: "(216) 555-0134" });
      expect(selectedLanguages(html)).toEqual(["es"]);
    });

    it("AC2, AC3: the form posts to saveDetails", async () => {
      await detailsAda();
      expect(actionsOf((await render({})).html)).toEqual(["saveDetails"]);
    });
  });

  // Issue 235: Save reading Saved is the confirmation, so a save that lands shows no Notice; what Save does once the page's
  // script runs is the browser's (e2e/form-changes.spec.ts). Here, what the server sends a browser with no script.
  describe("AC15 (issue 235) — a save that works shows no Notice", () => {
    it("AC15: with saved=1 the page shows no Notice", async () => {
      await detailsAda();
      const { element, html } = await render({ saved: "1" });
      expect(noticeIcons(element)).toEqual([]);
      expect(alertTexts(html)).toEqual([]);
    });
  });

  describe("AC6 (issue 235) — the server sends Save off", () => {
    /** Your details' buttons, each as its attributes. */
    const detailsButtons = (section: string) => [...section.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([markup]) => attributesOf(markup, "button")[0] ?? {});

    it.each([
      ["the page as it opens", {}],
      ["the page a save that works lands on", { saved: "1" }],
    ])("AC6: %s sends Your details' one button off", async (_what, query) => {
      await detailsAda();
      const buttons = detailsButtons((await render(query)).sections[1] ?? "");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toMatchObject({ type: "submit" });
      expect(buttons[0]).toHaveProperty("disabled");
    });
  });

  describe("AC4 (issue 156) — a save that broke a rule", () => {
    it("AC4: with error=firstName the field is marked invalid, and the form holds what was typed", async () => {
      await detailsAda();
      request.current.cookies[DRAFT] = JSON.stringify({ firstName: "", lastName: "Byron", email: OLD, phone: "216-555-0199", language: "en" });
      const { html } = await render({ error: "firstName" });
      expect(attributesOf(html, "input").find((input) => input.name === "firstName")).toMatchObject({ "aria-invalid": "true" });
      expect(valuesOf(html)).toMatchObject({ firstName: "", lastName: "Byron", phone: "(216) 555-0199" });
    });

    // Review of commit f65a2b3: the draft cookie lives ten minutes, so a member can come back to an error with none.
    it("AC4: with error=firstName and no draft cookie (expired), the form holds the member's stored details, not blank fields", async () => {
      await detailsAda("es");
      const { html } = await render({ error: "firstName" });
      expect(valuesOf(html)).toMatchObject({ firstName: "Ada", lastName: "Lovelace", email: OLD, phone: "(216) 555-0134" });
      expect(selectedLanguages(html)).toEqual(["es"]);
    });
  });

  // Issue 222: the box's rule is formatPhoneTyping's (src/phone.test.ts); the draft goes through it in AC4 above.
  describe("AC6 (issue 222) — the phone box starts formatted", () => {
    it("AC6: a stored phone of 216-555-0100 starts the box as (216) 555-0100", async () => {
      const member = await detailsAda();
      await services.repo.saveMemberDetails(member.id, { firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en", menuEmails: true });
      expect(valuesOf((await render({})).html).phone).toBe("(216) 555-0100");
    });
  });

  describe("AC7 (issue 156) — the code step", () => {
    it("AC7: with a change pending, the step has Keep the old email's form, the new address, the code field in the confirm form, and the resend form, in that order", async () => {
      const member = await detailsAda();
      await pending(member);
      const { html } = await render({});
      expect(actionsOf(html)).toEqual(["keepOldEmail", "confirmEmailChange", "resendEmailChange"]);
      expect(screenMarkup(html)).toContain(NEW);
      expect(attributesOf(html, "input").filter((input) => input.name === "code")).toHaveLength(1);
    });

    it("AC7: the code step stands in place of the form: no field holds the member's details", async () => {
      const member = await detailsAda();
      await pending(member);
      const { html } = await render({});
      expect(codeStepShows(html)).toBe(true);
      expect(Object.keys(valuesOf(html)).filter((name) => ["firstName", "lastName", "email", "phone"].includes(name))).toEqual([]);
    });
  });

  describe("AC10 (issue 156) — confirming", () => {
    it("AC10: the code form posts to confirmEmailChange", async () => {
      const member = await detailsAda();
      await pending(member);
      expect(actionsOf((await render({})).html)).toContain("confirmEmailChange");
    });
  });

  describe("AC11 (issue 156) — Square refused", () => {
    it("AC11: with error=square the code step shows an alert Notice", async () => {
      const member = await detailsAda();
      await pending(member);
      const { element, html } = await render({ error: "square" });
      expect(noticeIcons(element)).toEqual(["alert"]);
      expect(alertTexts(html)).toEqual([t("details.squareFailed")]);
      expect(codeStepShows(html)).toBe(true);
    });
  });

  describe("AC12 (issue 156) — a wrong or expired code", () => {
    it("AC12: with error=invalid the code field is marked invalid, with one alert", async () => {
      const member = await detailsAda();
      await pending(member);
      const { html } = await render({ error: "invalid" });
      expect(attributesOf(html, "input").find((input) => input.name === "code")).toMatchObject({ "aria-invalid": "true" });
      expect(alertTexts(html)).toEqual([t("details.invalidCode")]);
    });
  });

  describe("AC13 (issue 156) — Send a new code and the wait notice", () => {
    it("AC13: Send a new code posts to resendEmailChange", async () => {
      const member = await detailsAda();
      await pending(member);
      expect(actionsOf((await render({})).html)).toContain("resendEmailChange");
    });

    it("AC13: with sent=1 the code step says a new code is on its way", async () => {
      const member = await detailsAda();
      await pending(member);
      expect(noticeIcons((await render({ sent: "1" })).element)).toEqual(["check"]);
    });

    it("AC13: with limited=5 and a change pending, sign-in's wait notice shows once, in a lock Notice at the top, above the cards", async () => {
      const member = await detailsAda();
      await pending(member);
      const { element, html } = await render({ limited: "5" });
      expect(noticeIcons(element)).toEqual(["lock"]);
      expect(alertTexts(html)).toEqual([WAIT_5]);
      expect(ascending(positions(html, ['role="alert"', "<section"]))).toBe(true);
      expect(codeStepShows(html)).toBe(true);
    });

    it("AC13: with limited=5 and no change pending, sign-in's wait notice shows in a lock Notice at the top, above the form", async () => {
      await detailsAda();
      const { element, html } = await render({ limited: "5" });
      expect(noticeIcons(element)).toEqual(["lock"]);
      expect(alertTexts(html)).toEqual([WAIT_5]);
      expect(ascending(positions(html, ['role="alert"', "<section", "<form"]))).toBe(true);
      expect(valuesOf(html)).toMatchObject({ email: OLD });
    });
  });

  describe("AC14 (issue 156) — Keep the old email", () => {
    it("AC14: in the code step's own card, it is a quiet submit Button with the back arrow, alone in a form posting to keepOldEmail, before the step's heading, and the card has no link", async () => {
      const member = await detailsAda();
      await pending(member);
      const { element, sections } = await render({});
      const keep = findAll(element, "form").find((form) => form.props.action === keepOldEmail);
      expect(findAll(keep, Button).map((button) => button.props)).toEqual([expect.objectContaining({ kind: "quiet", back: true, type: "submit" })]);
      const step = sections.find((section) => actionsOf(section).includes("confirmEmailChange")) ?? "";
      expect(actionsOf(step)[0]).toBe("keepOldEmail");
      const heading = step.search(/<h[1-6]\b/);
      expect(heading).toBeGreaterThan(-1);
      expect(step.indexOf("<form")).toBeLessThan(heading);
      expect(attributesOf(step, "a")).toEqual([]);
    });
  });

  // Issue 141: the menu email checkbox, placed by its field, not its words. What Save stores is ./details-actions.test.ts's.
  describe("AC9 (issue 141) — Email me the weekly menu", () => {
    /** The form's menuEmails field: whether it is there, a checkbox, and ticked. */
    const menuBox = (html: string) => {
      const input = attributesOf(html, "input").find((candidate) => candidate.name === "menuEmails");
      return { present: input !== undefined, type: input?.type, checked: input !== undefined && "checked" in input };
    };

    it("AC9: after the Language field and before Save, the form has the checkbox, ticked for a member whose menu emails are on", async () => {
      await detailsAda();
      const { html } = await render({});
      expect(ascending(positions(html, ['name="language"', 'name="menuEmails"', 'type="submit"']))).toBe(true);
      expect(menuBox(html)).toEqual({ present: true, type: "checkbox", checked: true });
    });

    it("AC9: for a member whose menu emails are off it is not ticked", async () => {
      const member = await detailsAda();
      await services.repo.setMenuEmails(member.id, false);
      expect(menuBox((await render({})).html)).toEqual({ present: true, type: "checkbox", checked: false });
    });

    it("AC9: the checkbox is in the form that posts to saveDetails", async () => {
      await detailsAda();
      const save = formsOf((await render({})).html).find((form) => form.action === "saveDetails");
      expect(menuBox(save?.inner ?? "").present).toBe(true);
    });
  });

  describe("AC20 (issue 156) — a pending change is stored", () => {
    it("AC20: a member who comes back nine minutes after asking sees the code step again", async () => {
      const member = await detailsAda();
      await pending(member, 9 * MINUTE);
      const { html } = await render({});
      expect(codeStepShows(html)).toBe(true);
      expect(screenMarkup(html)).toContain(NEW);
    });

    it("AC20: after the code has expired they see the form with the old address", async () => {
      const member = await detailsAda();
      await pending(member, 11 * MINUTE);
      const { html } = await render({});
      expect(codeStepShows(html)).toBe(false);
      expect(valuesOf(html)).toMatchObject({ email: OLD });
    });
  });
});

// Issue 254: the no-card Notice. Whether a subscription needs a card is the repository's (needsCard, owned by
// src/adapters/signup-contract.ts and postgres-product.test.ts); here one present and one absent case through the page.
describe("AC17 (issue 254) — the no-card Notice on account home", () => {
  /** Whether one of the page's Notices holds a primary link to /account/card; its words are not read. */
  const noticeAsksForACard = (html: string): boolean => {
    const primary = attributesOf(renderToStaticMarkup(createElement(Button, { kind: "primary", href: "/account/card", children: "x" })), "a")[0];
    expect(primary?.class).toBeDefined();
    return [...html.matchAll(/<(\w+)\b[^>]*\brole="alert"[^>]*>([\s\S]*?)<\/\1>/g)].some(([, , inner = ""]) =>
      attributesOf(inner, "a").some((link) => link.href === "/account/card" && link.class === primary?.class),
    );
  };

  it("AC17: an active subscription with no card on file and no declined row: a Notice holds a primary link to /account/card", async () => {
    const member = await ada();
    const rows = await signup(member);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    signIn(member);
    expect(noticeAsksForACard((await render()).html)).toBe(true);
  });

  it("AC17: with a card on file whose brand and last four are not stored, there is none", async () => {
    await activeAda();
    vi.spyOn(services.repo, "findSubscriptionCard").mockResolvedValue(null);
    const { html } = await render();
    expect(noticeAsksForACard(html)).toBe(false);
    expect(alertTexts(html)).toEqual([]);
  });
});

// Issue 254: the charge line is shown in some states and not others: a choice, checked by its key, as AC15 (issue 198)'s.
describe("AC22 (issue 254) — the charge line with no card on file", () => {
  const CHARGE_LINE = t("supperClub.next.charge", { price: formatUsdWhole(4500) });

  it("AC22: with the no-card Notice drawn, the charge line is not shown", async () => {
    const member = await ada();
    const rows = await signup(member);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    signIn(member);
    const { html, runs } = await render();
    expect(alertTexts(html)).toHaveLength(1);
    expect(runs).not.toContain(CHARGE_LINE);
  });

  it("AC22: a comped subscription with no card draws no Notice, and the line is shown; guards the case above", async () => {
    const member = await ada();
    const rows = await signup(member);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    services.repo.markComped(rows.subscriptionId);
    signIn(member);
    const { html, runs } = await render();
    expect(alertTexts(html)).toEqual([]);
    expect(runs).toContain(CHARGE_LINE);
  });
});

// Issue 254: while a card update's charge has no answer the week stays declined, so the page is the declined page. What the
// claim writes is the repository's (src/adapters/charge-run-contract.ts).
describe("AC20 (issue 254) — account home while a card update's charge is out", () => {
  it("AC20: the declined Notice names the week and links to /account/card, the badge is Card declined's, and the charge line is not shown", async () => {
    const { member, subscriptionId } = await activeAda();
    await services.repo.setMemberSquareCustomer(member.id, "CUSTOMER_ADA");
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "declined", 4500);
    expect((await services.repo.claimCardUpdate(subscriptionId, NOW)).kind).toBe("claimed");
    const { html, badge, runs } = await render();
    const alerts = alertTexts(html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(titleOf(FEB_7));
    expect(attributesOf(html, "a").map((link) => link.href)).toContain("/account/card");
    expect(badge).toBe(SUBSCRIPTION_BADGES.declined.kind);
    expect(runs).not.toContain(t("supperClub.next.charge", { price: formatUsdWhole(4500) }));
  });
});

// Issue 254: where the Notice sits. Which one shows is AC5's (issue 198) and AC17's above; here one of each, by its column.
// Stacked below lg the left column is the first, so one order serves both widths.
describe("AC24 (issue 254) — the card Notice is in the left column, above the Supper Club card", () => {
  it.each<[string, () => Promise<unknown>]>([
    [
      "declined",
      async () => {
        const { subscriptionId } = await activeAda();
        await services.repo.addLedgerRow(subscriptionId, FEB_7, "declined", 4500);
      },
    ],
    [
      "no-card",
      async () => {
        const member = await ada();
        const rows = await signup(member);
        await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
        signIn(member);
      },
    ],
  ])("AC24: the %s Notice is the first thing in the left column, above the Supper Club card, and Your details' column holds none", async (_which, arrange) => {
    await arrange();
    const { element } = await render();
    const [left, right, ...more] = columnsOf(element);
    expect(more).toEqual([]);
    expect(orderIn(left)).toEqual(['role="alert"', "<section"]);
    expect(orderIn(right)).toEqual(["<section"]);
    expect(findAll(element, Notice)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Issue 238: the Supper Club card's buttons, the cancelled Notice's way back, and the bold meal in the pending line. Which
// week a switch starts from is switchWeek's (src/switch-meal.test.ts); how a Notice draws its action is
// components/ui/notice.test.ts's and how a value is bolded components/ui/bold-value.test.ts's.
describe("issue 238 — the Supper Club card's buttons", () => {
  const SWITCH = "/account?switch=1";
  const UPDATE_CARD = "/account/card";
  const CANCEL = "/account/cancel";

  it("AC1: with a switch week listed, the card holds exactly Switch, Update your card and Cancel, in that order", async () => {
    await activeAda();
    expect(linksOf((await render()).sections[0] ?? "")).toEqual([SWITCH, UPDATE_CARD, CANCEL]);
  });

  it("AC2: Switch and Update your card are secondary buttons in one row, and Cancel is a quiet button below the row", async () => {
    await activeAda();
    const card = findAll((await render()).element, CardBox)[0];
    const buttonsIn = (node: ReactElement | undefined) => findAll(node, Button).map(({ props }) => ({ kind: props.kind, href: props.href }));
    const row = [
      { kind: "secondary", href: SWITCH },
      { kind: "secondary", href: UPDATE_CARD },
    ];
    expect(findAll(card, ButtonRow).map(buttonsIn)).toEqual([row]);
    expect(buttonsIn(card)).toEqual([...row, { kind: "quiet", href: CANCEL }]);
  });

  it("AC3: with no switch week listed, at any query, the card holds Update your card and then Cancel, and no Switch", async () => {
    const { subscriptionId } = await activeAda();
    for (const weekOf of sundaysFrom(FEB_7, 12)) await services.repo.addLedgerRow(subscriptionId, weekOf, "paid", 4500);
    for (const query of [undefined, { switch: "1" }, { saved: "1" }]) {
      expect(linksOf((await render(query)).sections[0] ?? "")).toEqual([UPDATE_CARD, CANCEL]);
    }
  });
});

describe("issue 238 — a cancelled member's way back", () => {
  it("AC5: at any query, the cancelled Notice holds one link, to /supper-club, and the card holds none of Switch, Update your card and Cancel", async () => {
    const { subscriptionId } = await activeAda();
    await services.repo.cancelSubscription(subscriptionId, NOW);
    for (const query of [undefined, { switch: "1" }, { saved: "1" }]) {
      const { html, sections } = await render(query);
      const notices = [...html.matchAll(/<p\b[^>]*\brole="alert"[^>]*>([\s\S]*?)<\/p>/g)].map(([, inner = ""]) => inner);
      const cancelled = notices.filter((notice) => sentencesOf(notice).join(" ").includes(t("account.cancelledNotice")));
      expect(cancelled).toHaveLength(1);
      expect(linksOf(cancelled[0] ?? "")).toEqual(["/supper-club"]);
      for (const link of ["/account?switch=1", "/account/card", "/account/cancel"]) expect(linksOf(sections[0] ?? "")).not.toContain(link);
    }
  });

  it("AC9: the cancelled Notice, on the page exactly once, is the first thing in the left column, above the Supper Club card, and Your details' column holds none", async () => {
    const { subscriptionId } = await activeAda();
    await services.repo.cancelSubscription(subscriptionId, NOW);
    const { element, html } = await render();
    expect(alertTexts(html)).toEqual([expect.stringContaining(t("account.cancelledNotice"))]);
    const [left, right, ...more] = columnsOf(element);
    expect(more).toEqual([]);
    expect(orderIn(left)).toEqual(['role="alert"', "<section"]);
    expect(orderIn(right)).toEqual(["<section"]);
  });
});

describe("issue 238 — the pending-switch line", () => {
  it("AC6: the meal's name is in a strong element, and the start week outside it", async () => {
    const { subscriptionId } = await activeAda();
    await services.repo.switchPicks(subscriptionId, choiceOf(["3–4 people", "Vegan"]), MAR_7, 8000);
    const card = findAll((await render()).element, CardBox)[0];
    const lines = findAll(card, Hint)
      .map((hint) => renderToStaticMarkup(hint))
      .filter((hint) => sentencesOf(hint).includes(pendingLine("3–4 people · Vegan", MAR_7)));
    expect(lines).toHaveLength(1);
    const bold = [...(lines[0] ?? "").matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/g)].map(([, inner = ""]) => textsOf(inner).join(" "));
    expect(bold).toEqual(["3–4 people · Vegan"]);
  });
});
