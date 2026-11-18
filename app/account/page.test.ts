// Issue 136: the account home, `await Account()` with `next/headers` faked and the composition root mocked, as
// app/admin/page.test.ts renders /admin. A signed-in request is an ocf_session cookie for a member in an
// InMemoryRepository; a subscription is the rows a paid signup leaves. Read as the markup's text. Who counts as
// signed in is app/session.test.ts's (requireMember); which subscription is found is findSignupConfirmation's; which
// week is next is nextPickup's (src/pickup-week.test.ts), so here one week of each kind is read through the page.
// The header is faked, so what is read of it is the call the page makes; its buttons are app/site-header.test.ts's.
// The name's parts are memberDisplayName's (src/members.test.ts). The page is read by the values it shows, its badge's
// kind, its links and Notices, and the key of a line shown in some states and not others (issue 211), never its words.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator, type Language } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { en } from "@core/messages/en.js";
import { es } from "@core/messages/es.js";
import { formatUsdWhole } from "@core/money.js";
import { pickupWeek, weekdayName, weekTitle, type ChangedWeek } from "@core/pickup-week.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { Badge } from "../../components/ui/badge";
import { Notice } from "../../components/ui/notice";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, attributesOf, findAll, redirectOf, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import { SUBSCRIPTION_BADGES } from "../subscription-badges";
import { addSupperClub } from "../admin/subscribers-fixture";
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
  getSessionSecret: () => services.secret,
}));
vi.mock("../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

// Wednesday, February 3, noon in Cleveland. The calendar lists from the week of February 7 (its cutoff, the end of
// Monday, February 1, passed; its pickup to come), then February 14, and on: 12 weeks, to April 25.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const FEB_7 = "2027-02-07";
const FEB_14 = "2027-02-14";
const DAY = 24 * 60 * 60_000;

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

/** An active subscription: the signup's first charge paid. */
const subscribed = async (member: Member, options?: Parameters<typeof signup>[1]): Promise<void> => {
  const rows = await signup(member, options);
  await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
};

const change = (weekOf: string, over: Partial<ChangedWeek>) =>
  services.repo.savePickupWeek(product.id, { weekOf, closedAt: null, note: null, firstDay: null, lastDay: null, ...over });
const close = (weekOf: string) => change(weekOf, { closedAt: new Date("2027-01-20T15:00:00.000Z") });

/** The page's markup, its runs of text, all of it as one line, the meal card's badge kind, and how many Notices it shows. */
const render = async (): Promise<{ html: string; runs: string[]; text: string; badge: unknown; notices: number }> => {
  const element = await Account();
  const html = renderToStaticMarkup(element);
  const runs = textsOf(html);
  return { html, runs, text: runs.join(" "), badge: findAll(element, Badge)[0]?.props.kind, notices: findAll(element, Notice).length };
};

/** The page's text holds none of the listed weeks' titles: no next pickup is named. */
const namesNoWeek = (text: string): boolean => [FEB_7, FEB_14].every((weekOf) => !text.includes(titleOf(weekOf)));

/** The lines after the details card's heading, the last thing on the page: none when the heading is not shown. */
const detailsLines = (runs: string[], language: Language = "en"): string[] => {
  const heading = runs.indexOf((language === "en" ? en : es)["account.details"]);
  return heading === -1 ? [] : runs.slice(heading + 1);
};

/**
 * Issue 139: the details card's own lines after its heading, read from the card (a Card is a `<section>`) and not
 * from the page after it, which ends with the Cancel link on an active subscription. None when no card shows it.
 */
const detailsCardLines = (html: string, language: Language = "en"): string[] => {
  const heading = (language === "en" ? en : es)["account.details"];
  const card = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => textsOf(match[1] ?? "")).find((runs) => runs.includes(heading));
  return card === undefined ? [] : card.slice(card.indexOf(heading) + 1);
};

/** The title of the week of `weekOf` as the page's language writes it, with its row's days. */
const titleOf = (weekOf: string, changed: ChangedWeek | null = null): string => weekTitle(t, pickupWeek(weekOf, changed), "en");

describe("AC1 (issue 136) — /account, signed out", () => {
  it("AC1: a signed-out visitor is redirected to /sign-in", async () => {
    await expect(redirectOf(Account())).resolves.toBe("/sign-in");
  });
});

describe("AC2 (issue 136) — /account, signed in with no active, paid subscription", () => {
  it.each([
    ["no subscription at all", async () => {}],
    ["a pending signup", async (member: Member) => void (await signup(member))],
    [
      "a declined first charge",
      async (member: Member) => {
        await services.repo.recordSignupDecline((await signup(member)).ledgerId);
      },
    ],
  ])("AC2: a member with %s is redirected to /supper-club", async (_what, arrange) => {
    const member = await ada();
    await arrange(member);
    signIn(member);
    await expect(redirectOf(Account())).resolves.toBe("/supper-club");
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

// Issue 138: the newest set is findSignupConfirmation's (src/adapters/signup-contract.ts); here the page shows it once.
describe("AC5 (issue 138) — after a switch", () => {
  it("AC5: the page shows the newest picks and the new weekly price, though they start at a week to come", async () => {
    const member = await ada();
    await subscribed(member);
    signIn(member);
    const confirmation = await services.repo.findSignupConfirmation(member.id, product.id);
    const vegan = Object.fromEntries(
      product.optionTypes.map((type) => [type.id, type.options.find((option) => ["3–4 people", "Vegan"].includes(option.name))?.id ?? "no such option"]),
    );
    await services.repo.switchPicks(confirmation?.subscriptionId ?? "no subscription", vegan, "2027-03-07", 8000);
    const { runs, text } = await render();
    expect(runs).toContain("3–4 people · Vegan");
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
    const { text } = await render();
    expect(text).toContain(titleOf(FEB_7, moved));
    expect(text).toContain(weekdayName("2027-02-06", "en"));
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

  it("AC8: once the declined week's pickup has passed, Next pickup and its where line are replaced by one line, not a Notice; the charge line stays", async () => {
    await declinedAda("2027-01-31");
    const { html, runs, text, notices } = await render();
    expect(namesNoWeek(text)).toBe(true);
    expect(runs).toContain(NO_PICKUP);
    expect(text).toContain(formatUsdWhole(4500));
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

describe("AC4 (issue 136) — the details card", () => {
  it("AC4: it shows the name, then the email, then phone · language", async () => {
    const member = await ada();
    await subscribed(member);
    signIn(member);
    expect(detailsCardLines((await render()).html)).toEqual(["Ada Lovelace", "ada@example.com", "(216) 555-0134 · English"]);
  });

  it("AC4: the phone is shown exactly as stored, never reformatted", async () => {
    const member = await ada({ phone: "216.555.0134" });
    await subscribed(member);
    signIn(member);
    expect(detailsCardLines((await render()).html).at(-1)).toBe("216.555.0134 · English");
  });

  it("AC4: the language is named in itself: a Spanish-speaking member's line ends Español", async () => {
    const member = await ada({ language: "es" });
    await subscribed(member);
    signIn(member);
    // The page follows the cookie, then the browser, never the member (issue 130), so it renders in English here.
    expect(detailsCardLines((await render()).html).at(-1)).toBe("(216) 555-0134 · Español");
  });

  it("AC4: with no name and no phone, the name line is not shown and the last line is the language alone", async () => {
    const member = await services.repo.createMember({ email: "ada@example.com" });
    await subscribed(member);
    signIn(member);
    expect(detailsCardLines((await render()).html)).toEqual(["ada@example.com", "English"]);
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

// Issue 139: account home after a cancel. Who is let in is requireSubscriber's (app/account/subscriber.test.ts) and
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

  it("AC5: the meal card shows the meal and a Cancelled badge, and no Next pickup, charge line or Cancel link; the details card stays", async () => {
    const subscriptionId = await subscribedAda({ picks: ["2 people", "Vegan"] });
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "paid", 4500);
    await cancel(subscriptionId);
    const { html, runs, badge } = await render();
    expect(runs).toContain("2 people · Vegan");
    expect(badge).toBe(SUBSCRIPTION_BADGES.cancelled.kind);
    // The Notice names February 7 as the last pickup; the meal card names no week and no price.
    const mealCard = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => textsOf(match[1] ?? "").join(" "))[0] ?? "";
    expect(namesNoWeek(mealCard)).toBe(true);
    expect(mealCard).not.toContain(formatUsdWhole(4500));
    expect(hrefsOf(html)).not.toContain("/account/cancel");
    expect(detailsLines(runs)).toEqual(["Ada Lovelace", "ada@example.com", "(216) 555-0134 · English"]);
  });

  it("AC13: an active subscription's page ends, below the details card, with a link to /account/cancel; no Notice", async () => {
    await subscribedAda();
    const { html } = await render();
    expect(hrefsOf(html).at(-1)).toBe("/account/cancel");
    expect(html.lastIndexOf("</section>")).toBeLessThan(html.indexOf('href="/account/cancel"'));
    expect(alertTexts(html)).toEqual([]);
  });

  it("AC7: after a cancel and a new signup, paid, the page shows the new subscription: its meal, the Active badge, no Notice", async () => {
    const first = await subscribedAda();
    expect(await cancel(first)).toBe(true);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const member = await services.repo.findMemberByEmail("ada@example.com");
    if (!member) throw new Error("Ada is gone");
    const again = await signup(member, { picks: ["2 people", "Vegan"] });
    await services.repo.confirmSignupRows(again.ledgerId, `PAYMENT_${again.ledgerId}`, again.amountCents, NOW);
    const { html, runs, badge } = await render();
    expect(runs).toContain("2 people · Vegan");
    expect(badge).toBe(SUBSCRIPTION_BADGES.active.kind);
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
    const { html, badge } = await render();
    const alerts = alertTexts(html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(titleOf(FEB_7));
    expect(hrefsOf(html)).toContain("/account/card");
    expect(badge).toBe(SUBSCRIPTION_BADGES.declined.kind);
  });

  it("AC1: once the declined week's pickup has passed, the one Notice names no week; the button and badge stay", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, JAN_31);
    const { html, badge } = await render();
    const alerts = alertTexts(html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).not.toContain(titleOf(JAN_31));
    expect(hrefsOf(html)).toContain("/account/card");
    expect(badge).toBe(SUBSCRIPTION_BADGES.declined.kind);
  });

  it("AC13: when the declined row's week was closed, the Notice names no week, though its pickup is to come; the badge is still Card declined's", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, FEB_7);
    await close(FEB_7);
    const { html, badge } = await render();
    const alerts = alertTexts(html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).not.toContain(titleOf(FEB_7));
    expect(badge).toBe(SUBSCRIPTION_BADGES.declined.kind);
  });

  it("AC1: a cancelled subscription holding a declined row keeps the cancelled Notice and the Cancelled badge, and no declined Notice", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, JAN_31);
    await services.repo.cancelSubscription(subscriptionId, NOW);
    const { html, badge } = await render();
    expect(alertTexts(html)).toHaveLength(1);
    expect(badge).toBe(SUBSCRIPTION_BADGES.cancelled.kind);
    expect(hrefsOf(html)).not.toContain("/account/card");
  });
});
