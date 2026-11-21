// Issue 141, AC7: the public menu page, `await MenuPage()` with `next/headers` faked and the composition root mocked, as
// app/admin/members/[subscription]/page.test.ts renders its page. Which week is current and what it holds is
// currentWeekMenu's (src/menu-run.test.ts); a text's lines and the sections are menuSections' (src/menus.test.ts); the
// join panel's price and size are cheapestChoices' (src/products.test.ts). Here each of the page's states goes through it
// once. Which state shows is read from its heading's catalog line; the week, the menu and the price are values.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator, type Language } from "@core/i18n.js";
import type { Menu } from "@core/menus.js";
import { formatUsdWhole } from "@core/money.js";
import { pickupWeek, pickupWhereLine, weekTitle, type PickupWeek } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import { MENUS, SIZES } from "../admin/subscribers-fixture";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, escapeRegExp, inOrder, textsOf } from "../screen-test-helpers";
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

const t = createTranslator("en");
// The cheapest of each type: 2 people at $50 and Standard at $0 (app/admin/subscribers-fixture.ts). The panel picks
// this line over menu.join.bodyNoSize because the product has a size.
const JOIN_BODY = t("menu.join.body", { price: formatUsdWhole(5000), size: "2 people" });
// The heading is the choice between the two states: the week's menu, or the menu on the way.
const ON_THE_WAY = t("menu.onTheWay");

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

const heading = (week: PickupWeek) => t("menu.heading", { week: titleOf(week) });
/** Whether some text run on the page carries `value`. */
const carries = (html: string, value: string) => textsOf(html).some((text) => text.includes(value));
const joinsSupperClub = (html: string) => linksOf(html).some((link) => link.href === "/supper-club");

describe("AC7 — the menu, once its email has gone out", () => {
  it("AC7: signed out, it shows the eyebrow, Menu for the week, Pick up, each menu option's name and lines in position order, the allergens line, then the join panel", async () => {
    await sent();
    const html = await render();
    const menu = ["Standard", "Squash soup", "Rye bread", "Vegan", "Lentil soup", "Barley salad"];
    expect(inOrder(html, menu)).toEqual(menu);
    expect(textsOf(html)).toContain(heading(pickupWeek(WEEK, null)));
    expect(carries(html, pickupOf(pickupWeek(WEEK, null)))).toBe(true);
    expect(textsOf(html)).toContain(JOIN_BODY);
    expect(joinsSupperClub(html)).toBe(true);
  });

  it("AC7: the page is public: the header is the signed-out one with Sign in", async () => {
    await sent();
    await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ account: "sign-in" }));
  });

  it("AC7: Join the Supper Club links to /supper-club", async () => {
    await sent();
    expect(joinsSupperClub(await render())).toBe(true);
  });

  it("AC7: a moved week is named by its moved days, and Pick up names them", async () => {
    const moved: PickupWeek = { weekOf: WEEK, firstDay: "2027-01-16", lastDay: "2027-01-17" };
    await services.repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: moved.firstDay, lastDay: moved.lastDay });
    await sent();
    const html = await render();
    expect(textsOf(html)).toContain(heading(moved));
    expect(carries(html, pickupOf(moved))).toBe(true);
  });

  it("AC7: a closed week is never the current one: with January 17 closed, January 24's menu shows", async () => {
    await services.repo.assignWeekMenu(product.id, WEEK, autumn.id);
    await services.repo.closePickupWeek(product.id, WEEK, null, new Date("2027-01-12T15:00:00.000Z"));
    await sent(NEXT);
    expect(textsOf(await render())).toContain(heading(pickupWeek(NEXT, null)));
  });
});

// Issue 231, AC6: the current week's note, shown with its menu. The note is a value, so it is read as the page's text;
// with none, the page is the same page less the note's element: nothing stands in its place.
describe("AC6 (issue 231) — the week's note on the menu page", () => {
  const NOTE = "Bring a cooler bag this week";
  const noteOn = (week: string) => services.repo.savePickupWeek(product.id, { weekOf: week, closedAt: null, note: NOTE, firstDay: null, lastDay: null });

  /** The one element whose whole text is the note, as markup; undefined when there is none. */
  const noteElementOf = (html: string): string | undefined => new RegExp(`<(\\w+)\\b[^>]*>\\s*${escapeRegExp(NOTE)}\\s*</\\1>`).exec(html)?.[0];

  it("AC6 (issue 231): the current week's note shows with its menu, as the note line", async () => {
    await noteOn(WEEK);
    await sent();
    const html = await render();
    expect(textsOf(html)).toContain(heading(pickupWeek(WEEK, null)));
    expect(textsOf(html)).toContain(t("menu.note", { note: NOTE }));
    expect(carries(html, NOTE)).toBe(true);
  });

  it("AC6 (issue 231): with no note, the page renders no note element: it is the noted page with the note's element taken out", async () => {
    await sent();
    const withoutNote = await render();
    await noteOn(WEEK);
    const withNote = await render();
    const element = noteElementOf(withNote);
    expect(element, "the noted page has an element whose whole text is the note").toBeDefined();
    expect(withNote.replace(element ?? "", "")).toBe(withoutNote);
  });

  it("AC6 (issue 231): the note shows only where the menu does: a noted week whose email has not gone out is on the way, with no note", async () => {
    await noteOn(WEEK);
    await services.repo.assignWeekMenu(product.id, WEEK, autumn.id);
    const html = await render();
    expect(textsOf(html)).toContain(ON_THE_WAY);
    expect(carries(html, NOTE)).toBe(false);
  });
});

describe("AC7 — the menu is on the way", () => {
  const onTheWay = (html: string) => ({
    onTheWay: textsOf(html).includes(ON_THE_WAY),
    joins: joinsSupperClub(html),
    menuShown: textsOf(html).some((text) => text === "Squash soup" || text === "Lentil soup"),
  });
  const ON_THE_WAY_STATE = { onTheWay: true, joins: true, menuShown: false };

  it("AC7: a week with a menu whose email has not gone out says the menu is on the way, with the join panel, and shows no menu", async () => {
    await services.repo.assignWeekMenu(product.id, WEEK, autumn.id);
    expect(onTheWay(await render())).toEqual(ON_THE_WAY_STATE);
  });

  it("AC7: a week with no menu says the same", async () => {
    expect(onTheWay(await render())).toEqual(ON_THE_WAY_STATE);
  });

  it("AC7: with no current week at all, every listed week closed, it says the same", async () => {
    for (let i = 0; i < 12; i++) {
      const week = new Date(Date.parse(`${WEEK}T00:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10);
      await services.repo.closePickupWeek(product.id, week, null, NOW);
    }
    expect(onTheWay(await render())).toEqual(ON_THE_WAY_STATE);
  });

  it("AC7: the next week's menu sent does not stand in for the current week's: January 24 sent and January 17 not is still on the way", async () => {
    await services.repo.assignWeekMenu(product.id, WEEK, autumn.id);
    await sent(NEXT);
    expect(onTheWay(await render())).toEqual(ON_THE_WAY_STATE);
  });
});
