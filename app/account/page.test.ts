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
import { inOrder, redirectOf, textsOf } from "../screen-test-helpers";
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

describe("AC4 (issue 136) — the details card", () => {
  it("AC4: it shows the name, then the email, then phone · language", async () => {
    const member = await ada();
    await subscribed(member);
    signIn(member);
    expect(detailsLines((await render()).runs)).toEqual(["Ada Lovelace", "ada@example.com", "(216) 555-0134 · English"]);
  });

  it("AC4: the phone is shown exactly as stored, never reformatted", async () => {
    const member = await ada({ phone: "216.555.0134" });
    await subscribed(member);
    signIn(member);
    expect(detailsLines((await render()).runs).at(-1)).toBe("216.555.0134 · English");
  });

  it("AC4: the language is named in itself: a Spanish-speaking member's line ends Español", async () => {
    const member = await ada({ language: "es" });
    await subscribed(member);
    signIn(member);
    // The page follows the cookie, then the browser, never the member (issue 130), so it renders in English here.
    expect(detailsLines((await render()).runs).at(-1)).toBe("(216) 555-0134 · Español");
  });

  it("AC4: with no name and no phone, the name line is not shown and the last line is the language alone", async () => {
    const member = await services.repo.createMember({ email: "ada@example.com" });
    await subscribed(member);
    signIn(member);
    expect(detailsLines((await render()).runs)).toEqual(["ada@example.com", "English"]);
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
