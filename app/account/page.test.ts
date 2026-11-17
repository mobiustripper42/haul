// Issue 136: the account home, `await Account()` with `next/headers` faked and the composition root mocked, as
// app/admin/page.test.ts renders /admin. A signed-in request is an ocf_session cookie for a member in an
// InMemoryRepository; a subscription is the rows a paid signup leaves. Read as the markup's text. Who counts as
// signed in is app/session.test.ts's (requireMember); which subscription is found is findSignupConfirmation's; which
// week is next is nextPickup's (src/pickup-week.test.ts), so here one week of each kind is read through the page.
// The header is faked, so what is read of it is the call the page makes; its buttons are app/site-header.test.ts's.
// The name's parts are memberDisplayName's (src/members.test.ts). "Next pickup: {week}" is new copy, typed once.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator, type Language } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { en } from "@core/messages/en.js";
import { es } from "@core/messages/es.js";
import { formatUsdWhole } from "@core/money.js";
import { pickupWeek, pickupWhereLine, weekTitle, type ChangedWeek } from "@core/pickup-week.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, attributesOf, inOrder, redirectOf, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
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
const LISTED = Array.from({ length: 12 }, (_, i) => new Date(Date.parse(`${FEB_7}T00:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10));
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

/** The page's markup, its runs of text, and all of it as one line. */
const render = async (): Promise<{ html: string; runs: string[]; text: string }> => {
  const html = renderToStaticMarkup(await Account());
  const runs = textsOf(html);
  return { html, runs, text: runs.join(" ") };
};

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
    expect((await render()).text).toContain(t("supperClub.next.charge", { price: formatUsdWhole(4500) }));
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
    expect(text).toContain(t("supperClub.next.charge", { price: formatUsdWhole(8000) }));
  });
});

describe("AC3b (issue 136) — the next pickup", () => {
  it('AC3b: for a member whose first week is past, it is the first listed week: "Next pickup: February 7 and 8", then the where line', async () => {
    const member = await ada();
    await subscribed(member);
    signIn(member);
    const { html } = await render();
    const where = en["supperClub.box.pickupWhere"];
    expect(inOrder(html, ["Next pickup: February 7 and 8", where])).toEqual(["Next pickup: February 7 and 8", where]);
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
    expect(text).toContain(pickupWhereLine(t, pickupWeek(FEB_7, moved), "en"));
    expect(text).not.toContain(en["supperClub.box.pickupWhere"]);
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

  it("AC3b: when every listed week is closed, neither the next-pickup line nor the where line is shown; the rest of the card is", async () => {
    for (const weekOf of LISTED) await close(weekOf);
    const member = await ada();
    await subscribed(member);
    signIn(member);
    const { text } = await render();
    expect(text).toContain(t("supperClub.next.charge", { price: formatUsdWhole(4500) }));
    for (const weekOf of LISTED) expect(text).not.toContain(titleOf(weekOf));
    expect(text).not.toContain(en["supperClub.box.pickupWhere"]);
  });
});

// Issue 196: the next-pickup line while locked. Which week is next while locked is nextPickup's
// (src/pickup-week.test.ts) and which week is declined findMemberSubscription's (src/adapters/charge-run-contract.ts);
// here one locked and one unlocked case through the page. The no-pickup line is new copy, typed once here.
describe("AC8 (issue 196) — the next pickup while locked", () => {
  const NO_PICKUP = "No pickup until your card is updated.";

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
    const { html, text } = await render();
    const charge = t("supperClub.next.charge", { price: formatUsdWhole(4500) });
    expect(inOrder(html, ["2 people · Standard", NO_PICKUP, charge])).toEqual(["2 people · Standard", NO_PICKUP, charge]);
    expect(text).not.toContain("Next pickup:");
    expect(text).not.toContain(en["supperClub.box.pickupWhere"]);
    // Issue 145: the declined Notice is the page's only alert, and the no-pickup line is in none.
    const alerts = alertTexts(html);
    expect(alerts).toEqual([expect.stringMatching(/^Your card was declined\. /)]);
    expect(alerts.some((alert) => alert.includes(NO_PICKUP))).toBe(false);
  });

  it("AC8: in Spanish the line is No hay recogida hasta que actualice su tarjeta.", async () => {
    await declinedAda("2027-01-31");
    request.current.cookies.lang = "es";
    expect((await render()).runs).toContain("No hay recogida hasta que actualice su tarjeta.");
  });

  it("AC8: while the declined week's pickup is still to come, Next pickup names it, with its where line, and the no-pickup line is not shown", async () => {
    await declinedAda(FEB_7);
    const { html, text } = await render();
    const where = en["supperClub.box.pickupWhere"];
    expect(inOrder(html, ["Next pickup: February 7 and 8", where])).toEqual(["Next pickup: February 7 and 8", where]);
    expect(text).not.toContain(NO_PICKUP);
  });

  it("AC8 [code]: a cancelled subscription holding a declined row shows the cancelled card as today, with no no-pickup line", async () => {
    const subscriptionId = await declinedAda("2027-01-31");
    await services.repo.cancelSubscription(subscriptionId, NOW);
    const { html, text } = await render();
    expect(alertTexts(html)).toHaveLength(1);
    expect(text).not.toContain(NO_PICKUP);
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
// sentences goes through the page once. The cancelled words are new copy, typed once here; "Cancel the Supper Club" too.
describe("issue 139 — account home, cancelled and not", () => {
  const CANCEL_LINK = "Cancel the Supper Club";
  const CANCELLED = "Your Supper Club is cancelled.";
  const NOTHING_MORE = "Nothing more is charged. You can join again any time while there are meals.";

  /** Ada, signed in, with an active subscription paid for January 3; its id. */
  const subscribedAda = async (options?: Parameters<typeof signup>[1]): Promise<string> => {
    const member = await ada();
    const rows = await signup(member, options);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    signIn(member);
    return rows.subscriptionId;
  };

  const cancel = (subscriptionId: string) => services.repo.cancelSubscription(subscriptionId, NOW);

  /** Each link on the page: where it goes, and its text. */
  const linksOf = (html: string): { href: string; text: string }[] =>
    [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
      href: attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "",
      text: textsOf(inner).join(" "),
    }));

  it("AC5: with a paid week still to come, the Notice says it is cancelled, then Your last pickup is {week}., then nothing more is charged", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "paid", 4500);
    await cancel(subscriptionId);
    expect(alertTexts((await render()).html)).toEqual([`${CANCELLED} Your last pickup is ${titleOf(FEB_7)}. ${NOTHING_MORE}`]);
  });

  it("AC5: once the last paid week has passed, the Notice says Your last pickup was {week}.", async () => {
    const subscriptionId = await subscribedAda();
    await cancel(subscriptionId);
    expect(alertTexts((await render()).html)).toEqual([`${CANCELLED} Your last pickup was ${titleOf("2027-01-03")}. ${NOTHING_MORE}`]);
  });

  it("AC5: with no paid week, the signup's week closed after it was paid, the Notice has no pickup sentence", async () => {
    const subscriptionId = await subscribedAda();
    await services.repo.closePickupWeek(product.id, "2027-01-03", null, new Date("2027-01-03T16:00:00.000Z"));
    await cancel(subscriptionId);
    expect(alertTexts((await render()).html)).toEqual([`${CANCELLED} ${NOTHING_MORE}`]);
  });

  it("AC5: the meal card shows the meal and a Cancelled badge, and no Next pickup, where line, charge line or Cancel link; the details card stays", async () => {
    const subscriptionId = await subscribedAda({ picks: ["2 people", "Vegan"] });
    await services.repo.addLedgerRow(subscriptionId, FEB_7, "paid", 4500);
    await cancel(subscriptionId);
    const { html, runs, text } = await render();
    expect(inOrder(html, ["2 people · Vegan", "Cancelled", en["account.details"]])).toEqual(["2 people · Vegan", "Cancelled", en["account.details"]]);
    expect(runs).not.toContain(en["account.active"]);
    expect(text).not.toContain("Next pickup:");
    expect(text).not.toContain(en["supperClub.box.pickupWhere"]);
    expect(text).not.toContain(t("supperClub.next.charge", { price: formatUsdWhole(4500) }));
    expect(runs).not.toContain(CANCEL_LINK);
    expect(detailsLines(runs)).toEqual(["Ada Lovelace", "ada@example.com", "(216) 555-0134 · English"]);
  });

  it("AC13: an active subscription's page ends, below the details card, with Cancel the Supper Club, a link to /account/cancel; no Notice", async () => {
    await subscribedAda();
    const { html, runs } = await render();
    expect(runs.at(-1)).toBe(CANCEL_LINK);
    expect(inOrder(html, [en["account.details"], CANCEL_LINK])).toEqual([en["account.details"], CANCEL_LINK]);
    expect(linksOf(html)).toContainEqual({ href: "/account/cancel", text: CANCEL_LINK });
    expect(alertTexts(html)).toEqual([]);
  });

  it("AC7: after a cancel and a new signup, paid, the page shows the new subscription: its meal, Active, no Notice", async () => {
    const first = await subscribedAda();
    expect(await cancel(first)).toBe(true);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const member = await services.repo.findMemberByEmail("ada@example.com");
    if (!member) throw new Error("Ada is gone");
    const again = await signup(member, { picks: ["2 people", "Vegan"] });
    await services.repo.confirmSignupRows(again.ledgerId, `PAYMENT_${again.ledgerId}`, again.amountCents, NOW);
    const { html, runs } = await render();
    expect(runs).toContain("2 people · Vegan");
    expect(runs).toContain(en["account.active"]);
    expect(alertTexts(html)).toEqual([]);
  });
});

// Issue 145: account home with a declined card. Which rows are declined, and whether a row's week is closed, is the
// repository's (src/adapters/charge-run-contract.ts), and which week is next while locked is nextPickup's; here the
// page's own rule: the "is still made" sentence while the declined week's pickup is to come and its week is open. A
// declined row is the fake's addLedgerRow seam, as a charge run's decline leaves it; with the lock (issue 196) there is
// one. The Notice's words and "Update your card" are new copy, typed once here; "Card declined" is the admin's existing
// word, read from the catalog.
describe("issue 145 — AC1, AC13: account home with a declined card", () => {
  const JAN_31 = "2027-01-31";
  const LEAD = "Your card was declined.";
  const KEEP = "Update it to keep your meal.";
  const UPDATE = "Update your card";

  /** Ada, signed in, with an active subscription paid for January 3; its id. */
  const subscribedAda = async (): Promise<string> => {
    const member = await ada();
    const rows = await signup(member);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    signIn(member);
    return rows.subscriptionId;
  };

  const declined = (subscriptionId: string, weekOf: string) => services.repo.addLedgerRow(subscriptionId, weekOf, "declined", 4500);

  /** The Notices' words, the Update your card button's set aside, wherever the button sits under them. */
  const noticeWords = (html: string): string[] => alertTexts(html).map((text) => text.replace(new RegExp(` ?${UPDATE}$`), ""));

  /** Each link on the page: where it goes, and its text. */
  const linksOf = (html: string): { href: string; text: string }[] =>
    [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
      href: attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "",
      text: textsOf(inner).join(" "),
    }));

  it("AC1: an active subscription holding a declined row whose pickup is to come: the Notice says its meal is still made, Update your card goes to /account/card, and the badge reads Card declined, not Active", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, FEB_7);
    const { html, runs } = await render();
    expect(noticeWords(html)).toEqual([`${LEAD} ${KEEP} Your meal for ${titleOf(FEB_7)} is still made.`]);
    expect(linksOf(html)).toContainEqual({ href: "/account/card", text: UPDATE });
    expect(runs).toContain(en["admin.members.cardDeclined"]);
    expect(runs).not.toContain(en["account.active"]);
  });

  it("AC1: once the declined week's pickup has passed, the Notice keeps its lead and Update it to keep your meal., with no is-still-made sentence; the button and badge stay", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, JAN_31);
    const { html, runs } = await render();
    expect(noticeWords(html)).toEqual([`${LEAD} ${KEEP}`]);
    expect(linksOf(html)).toContainEqual({ href: "/account/card", text: UPDATE });
    expect(runs).toContain(en["admin.members.cardDeclined"]);
  });

  it("AC1: Update your card is its own catalog key, account.updateCard, not the card page's title: rewording the title leaves the button as it is", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, FEB_7);
    const catalog = en as unknown as Record<string, string>;
    const title = catalog["account.card.title"];
    catalog["account.card.title"] = "The card page's title, reworded";
    try {
      const { html } = await render();
      expect(linksOf(html).filter((link) => link.href === "/account/card")).toEqual([{ href: "/account/card", text: UPDATE }]);
    } finally {
      if (title !== undefined) catalog["account.card.title"] = title;
    }
  });

  it("AC13: when the declined row's week was closed, the Notice shows without the is-still-made sentence, though its pickup is to come; the badge still reads Card declined", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, FEB_7);
    await close(FEB_7);
    const { html, runs } = await render();
    expect(noticeWords(html)).toEqual([`${LEAD} ${KEEP}`]);
    expect(runs).toContain(en["admin.members.cardDeclined"]);
  });

  it("AC1: a cancelled subscription holding a declined row keeps the cancelled Notice and the Cancelled badge, and no declined Notice", async () => {
    const subscriptionId = await subscribedAda();
    await declined(subscriptionId, JAN_31);
    await services.repo.cancelSubscription(subscriptionId, NOW);
    const { html, runs } = await render();
    expect(alertTexts(html)).toEqual([expect.stringMatching(/^Your Supper Club is cancelled\. /)]);
    expect(runs).toContain(en["account.cancelled"]);
    expect(runs).not.toContain(en["admin.members.cardDeclined"]);
    expect(linksOf(html).map((link) => link.href)).not.toContain("/account/card");
  });
});
