// Issue 141, AC7: the public menu page, `await MenuPage()` with `next/headers` faked and the composition root mocked, as
// app/admin/members/[subscription]/page.test.ts renders its page. Which week is current and what it holds is
// currentWeekMenu's (src/menu-run.test.ts); a text's lines and the sections are menuSections' (src/menus.test.ts); the
// join panel's price and size are cheapestChoices' (src/products.test.ts). Here each of the page's states goes through it
// once. The page's words are new copy, typed once here; the Supper Club's join button is read from the catalog.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator, type Language } from "@core/i18n.js";
import { en } from "@core/messages/en.js";
import type { Menu } from "@core/menus.js";
import { pickupWeek, pickupWhereLine, weekTitle, type PickupWeek } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import { MENUS, SIZES } from "../admin/subscribers-fixture";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, inOrder, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import MenuPage from "./page";

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
vi.mock("next/navigation", async () => ({
  redirect: (await import("../screen-test-helpers")).throwingRedirect,
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("the menu page has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

/** Thursday January 14, noon in Cleveland: the current week is January 17. */
const NOW = new Date("2027-01-14T17:00:00.000Z");
const WEEK = "2027-01-17";
const NEXT = "2027-01-24";

// This task's words.
const EYEBROW = "SUPPER CLUB · THIS WEEK";
const ALLERGENS = "Allergens are marked on the packaging. Some dishes come with one or two quick steps to finish at home.";
const ON_THE_WAY = "The menu is on the way";
const ON_THE_WAY_BODY = "The farm posts it a few days before pickup, and members get it by email.";
const NOT_A_MEMBER = "Not a member?";
// The cheapest of each type: 2 people at $50 and Standard at $0 (app/admin/subscribers-fixture.ts).
const JOIN_BODY = "Weekly meals from the farm kitchen, $50 for 2 people.";

let product: ProductWithOptions;
let autumn: Menu;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.mocked(SiteHeader).mockClear();
  product = services.repo.addProduct({
    name: "Supper Club",
    cap: 50,
    firstPickupDate: "2027-01-03",
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes: [SIZES, { ...MENUS, menuTexts: true }],
  });
  const [standard, vegan] = product.optionTypes[1]?.options ?? [];
  autumn = await services.repo.createMenu({
    name: "Autumn harvest",
    texts: { [standard?.id ?? "no standard"]: "Squash soup\nRye bread", [vegan?.id ?? "no vegan"]: "Lentil soup\n\n  Barley salad " },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The week holds the autumn menu, and its email has gone out. */
const sent = async (week: string = WEEK): Promise<void> => {
  await services.repo.assignWeekMenu(product.id, week, autumn.id);
  await services.repo.markWeekMenuSent(product.id, week, NOW);
};

const render = async (): Promise<string> => renderToStaticMarkup(await MenuPage());

const titleOf = (week: PickupWeek, language: Language = "en") => weekTitle(createTranslator(language), week, language);
const pickupOf = (week: PickupWeek, language: Language = "en") => pickupWhereLine(createTranslator(language), week, language);

/** Each link on the page: where it goes and its text. */
const linksOf = (html: string): { href: string; text: string }[] =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    href: attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "",
    text: textsOf(inner).join(" "),
  }));

const JOIN_PANEL = [NOT_A_MEMBER, JOIN_BODY, en["supperClub.joinTitle"]];

describe("AC7 — the menu, once its email has gone out", () => {
  it("AC7: signed out, it shows the eyebrow, Menu for the week, Pick up, each menu option's name and lines in position order, the allergens line, then the join panel", async () => {
    await sent();
    const html = await render();
    const order = [
      EYEBROW,
      `Menu for ${titleOf(pickupWeek(WEEK, null))}`,
      `Pick up ${pickupOf(pickupWeek(WEEK, null))}`,
      "Standard",
      "Squash soup",
      "Rye bread",
      "Vegan",
      "Lentil soup",
      "Barley salad",
      ALLERGENS,
      ...JOIN_PANEL,
    ];
    expect(inOrder(html, order)).toEqual(order);
    expect(textsOf(html)).not.toContain(ON_THE_WAY);
  });

  it("AC7: the page is public: the header is the signed-out one with Sign in", async () => {
    await sent();
    await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ account: "sign-in" }));
  });

  it("AC7: Join the Supper Club links to /supper-club", async () => {
    await sent();
    expect(linksOf(await render())).toContainEqual({ href: "/supper-club", text: en["supperClub.joinTitle"] });
  });

  it("AC7: a moved week is named by its moved days, and Pick up names them", async () => {
    const moved: PickupWeek = { weekOf: WEEK, firstDay: "2027-01-16", lastDay: "2027-01-17" };
    await services.repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: moved.firstDay, lastDay: moved.lastDay });
    await sent();
    const texts = textsOf(await render());
    expect(texts).toEqual(expect.arrayContaining([`Menu for ${titleOf(moved)}`, `Pick up ${pickupOf(moved)}`]));
  });

  it("AC7: in Spanish, Pick up is Recogida over the Spanish pickup line, and the week is the Spanish title", async () => {
    request.current.cookies.lang = "es";
    await sent();
    const texts = textsOf(await render());
    expect(texts).toEqual(expect.arrayContaining([`Recogida: ${pickupOf(pickupWeek(WEEK, null), "es")}`]));
    expect(texts.some((text) => text.includes(titleOf(pickupWeek(WEEK, null), "es")))).toBe(true);
  });

  it("AC7: a closed week is never the current one: with January 17 closed, January 24's menu shows", async () => {
    await services.repo.assignWeekMenu(product.id, WEEK, autumn.id);
    await services.repo.closePickupWeek(product.id, WEEK, null, new Date("2027-01-12T15:00:00.000Z"));
    await sent(NEXT);
    expect(textsOf(await render())).toContain(`Menu for ${titleOf(pickupWeek(NEXT, null))}`);
  });
});

describe("AC7 — the menu is on the way", () => {
  const onTheWay = (html: string) => {
    const texts = textsOf(html);
    return {
      order: inOrder(html, [ON_THE_WAY, ON_THE_WAY_BODY, ...JOIN_PANEL]),
      menuShown: texts.some((text) => text.startsWith("Menu for") || text === "Squash soup" || text === ALLERGENS),
    };
  };
  const ON_THE_WAY_ORDER = [ON_THE_WAY, ON_THE_WAY_BODY, ...JOIN_PANEL];

  it("AC7: a week with a menu whose email has not gone out says the menu is on the way, with the join panel, and shows no menu", async () => {
    await services.repo.assignWeekMenu(product.id, WEEK, autumn.id);
    expect(onTheWay(await render())).toEqual({ order: ON_THE_WAY_ORDER, menuShown: false });
  });

  it("AC7: a week with no menu says the same", async () => {
    expect(onTheWay(await render())).toEqual({ order: ON_THE_WAY_ORDER, menuShown: false });
  });

  it("AC7: with no current week at all, every listed week closed, it says the same", async () => {
    for (let i = 0; i < 12; i++) {
      const week = new Date(Date.parse(`${WEEK}T00:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10);
      await services.repo.closePickupWeek(product.id, week, null, NOW);
    }
    expect(onTheWay(await render())).toEqual({ order: ON_THE_WAY_ORDER, menuShown: false });
  });

  it("AC7: the next week's menu sent does not stand in for the current week's: January 24 sent and January 17 not is still on the way", async () => {
    await services.repo.assignWeekMenu(product.id, WEEK, autumn.id);
    await sent(NEXT);
    expect(onTheWay(await render())).toEqual({ order: ON_THE_WAY_ORDER, menuShown: false });
  });
});
