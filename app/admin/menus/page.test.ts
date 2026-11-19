// Issue 140: the menu library, /admin/menus, rendered through react-dom/server with `next/headers` faked and the
// composition root mocked, as app/admin/weeks/page.test.ts renders the calendar. Read as its markup and text, and
// for the words only a search can show, as the tree it returns: what it gives `MenusList`. The list's own markup is
// ./menus-list.test.ts's; which weeks a menu is on is assignedWeeks' (src/menus.test.ts) and which line names them
// assignedLine's (./assigned.test.ts), so this asserts the week titles that reach the page; who may see the page is
// app/admin/admin-guard.test.ts's, with one signed-out and one member case here.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Menu } from "@core/menus.js";
import type { Role } from "@core/members.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../../next-headers-fake";
import { alertTexts, attributesOf, findAll, redirectOf, screenMarkup, textsOf } from "../../screen-test-helpers";
import { SiteHeader } from "../../site-header";
import { addSupperClub, MENUS, SIZES } from "../subscribers-fixture";
import { MenusList } from "./menus-list";
import AdminMenus from "./page";

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
    throw new Error("/admin/menus has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

// Wednesday, February 3, 2027, noon in Cleveland: the calendar lists February 7 to April 25.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const FEB_14 = "2027-02-14";
const FEB_21 = "2027-02-21";

let product: ProductWithOptions;
let standard: string;
let vegan: string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  product = addSupperClub(services.repo, { optionTypes: [SIZES, { ...MENUS, menuTexts: true }] });
  const options = product.optionTypes.find((type) => type.name === MENUS.name)?.options ?? [];
  standard = options.find((option) => option.name === "Standard")?.id ?? "no standard";
  vegan = options.find((option) => option.name === "Vegan")?.id ?? "no vegan";
});

afterEach(() => {
  vi.useRealTimers();
});

async function signInAs(role: Role): Promise<void> {
  const member = await services.repo.createMember({ email: "lenny@example.com", role });
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(Date.now() + DAY).toISOString() }, services.secret);
}

/** A menu saved a minute after the last, so the library's order is the order they were made in. */
let minute = 0;
const made = async (name: string, forStandard: string, forVegan: string): Promise<Menu> => {
  vi.setSystemTime(new Date(NOW.getTime() + ++minute * 60_000));
  return services.repo.createMenu({ name, texts: { [standard]: forStandard, [vegan]: forVegan } });
};

const pageOf = (query: Record<string, string> = {}) => AdminMenus({ searchParams: Promise.resolve(query) });
const render = async (query: Record<string, string> = {}) => renderToStaticMarkup(await pageOf(query));

/** Of `wanted`, the texts the page shows, in the order it shows them. */
const inSequence = (html: string, wanted: readonly string[]): string[] => {
  const found: string[] = [];
  let from = 0;
  const texts = textsOf(html);
  for (const item of wanted) {
    const at = texts.indexOf(item, from);
    if (at === -1) continue;
    found.push(item);
    from = at + 1;
  }
  return found;
};

/** Each link: its path and query, its text, and whether it is marked as the page showing. */
const linksOf = (html: string) =>
  [...screenMarkup(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => {
    const url = new URL(attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "", "http://haul.test/admin/menus");
    return { path: url.pathname, query: Object.fromEntries(url.searchParams), text: textsOf(inner).join(" "), current: /\baria-current="page"/.test(attrs) };
  });

describe("AC13 — only an admin opens the library", () => {
  it("AC13: a signed-out visitor goes to /sign-in", async () => {
    await expect(redirectOf(pageOf())).resolves.toBe("/sign-in");
  });

  it("AC13: a signed-in member whose role is not admin goes to /", async () => {
    await signInAs("member");
    await expect(redirectOf(pageOf())).resolves.toBe("/");
  });
});

describe("AC1 — the library", () => {
  beforeEach(async () => {
    await signInAs("admin");
  });

  // Issue 159: the admin links moved into the header (faked here); the page names itself to it and draws no nav of its own.
  it('AC5 (issue 159): the page asks for the header with current "admin-menus", and no link on it is marked as the page showing', async () => {
    vi.mocked(SiteHeader).mockClear();
    const html = await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "admin-menus" }));
    expect(linksOf(html).filter((link) => link.current)).toEqual([]);
  });

  it("AC1: every menu, most recently saved first, each with its name, its first option's text on one line, the weeks it is on, Edit and Duplicate", async () => {
    const autumn = await made("Autumn harvest", "Squash soup\nRye bread", "Lentil soup");
    const winter = await made("Winter roots", "Beef stew\nPotato rolls", "Mushroom stew");
    await services.repo.assignWeekMenu(product.id, FEB_21, autumn.id);
    await services.repo.assignWeekMenu(product.id, FEB_14, autumn.id);
    const html = await render();
    const text = textsOf(html).join(" ");
    const wanted = ["Winter roots", "Beef stew · Potato rolls", "Autumn harvest", "Squash soup · Rye bread", "February 14 and 15 · February 21 and 22"];
    const at = wanted.map((value) => text.indexOf(value));
    expect(at).not.toContain(-1);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // Winter roots is on no week: no week title stands between it and Autumn harvest.
    expect(text.slice(at[0], at[2])).not.toMatch(/February/);
    // Each menu's Edit, then its Duplicate, in the list's order.
    const menuLinks = linksOf(html)
      .filter((link) => link.path === `/admin/menus/${winter.id}` || link.path === `/admin/menus/${autumn.id}` || link.query.from !== undefined)
      .map(({ path, query }) => ({ path, query }));
    expect(menuLinks).toEqual([
      { path: `/admin/menus/${winter.id}`, query: {} },
      { path: "/admin/menus/new", query: { from: winter.id } },
      { path: `/admin/menus/${autumn.id}`, query: {} },
      { path: "/admin/menus/new", query: { from: autumn.id } },
    ]);
  });

  it("AC1: a menu whose only week is closed names no week, and the week comes back on the line once it is reopened", async () => {
    const autumn = await made("Autumn harvest", "Squash soup", "Lentil soup");
    await services.repo.assignWeekMenu(product.id, FEB_14, autumn.id);
    await services.repo.closePickupWeek(product.id, FEB_14, null, NOW);
    expect(textsOf(await render()).join(" ")).not.toContain("February 14 and 15");
    await services.repo.reopenPickupWeek(product.id, FEB_14);
    expect(textsOf(await render()).join(" ")).toContain("February 14 and 15");
  });

  it("AC1: a save moves a menu to the top of the list", async () => {
    const autumn = await made("Autumn harvest", "Squash soup", "Lentil soup");
    await made("Winter roots", "Beef stew", "Mushroom stew");
    vi.setSystemTime(new Date(NOW.getTime() + ++minute * 60_000));
    await services.repo.saveMenu(autumn.id, { name: "Late autumn", texts: autumn.texts });
    const wanted = ["Late autumn", "Winter roots"];
    expect(inSequence(await render(), wanted)).toEqual(wanted);
  });

  it("AC3: the list opens with no search", async () => {
    await made("Autumn harvest", "Squash soup", "Lentil soup");
    const [list, ...others] = findAll(await pageOf(), MenusList);
    expect(others).toEqual([]);
    expect(list?.props.query ?? "").toBe("");
  });

  it("AC4: New menu links to /admin/menus/new", async () => {
    await made("Autumn harvest", "Squash soup", "Lentil soup");
    expect(linksOf(await render())).toContainEqual(expect.objectContaining({ path: "/admin/menus/new", query: {} }));
  });
});

describe("AC2 — the empty library", () => {
  it("AC2: with no menus: a level-2 heading and New menu; no search and no list", async () => {
    await signInAs("admin");
    const tree = await pageOf();
    const html = renderToStaticMarkup(tree);
    expect([...screenMarkup(html).matchAll(/<h2\b/g)]).toHaveLength(1);
    expect(linksOf(html)).toContainEqual(expect.objectContaining({ path: "/admin/menus/new" }));
    expect(attributesOf(html, "input").filter((input) => input.type === "search")).toEqual([]);
    expect(findAll(tree, MenusList)).toEqual([]);
  });
});

describe("AC4, AC5 — the notice after a save", () => {
  beforeEach(async () => {
    await signInAs("admin");
  });

  it("AC4, AC5: ?saved=<menu id> shows one notice naming that menu", async () => {
    const autumn = await made("Autumn harvest", "Squash soup", "Lentil soup");
    await made("Winter roots", "Beef stew", "Mushroom stew");
    const alerts = alertTexts(await render({ saved: autumn.id }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("Autumn harvest");
    expect(alerts[0]).not.toContain("Winter roots");
  });

  it.each([
    ["an unknown id", "00000000-0000-4000-8000-000000000000"],
    ["a string that isn't a UUID", "not-a-uuid"],
  ])("AC4, AC5: ?saved= %s shows no notice", async (_what, saved) => {
    await made("Autumn harvest", "Squash soup", "Lentil soup");
    const html = await render({ saved });
    expect(alertTexts(html)).toEqual([]);
    expect(textsOf(html)).toContain("Autumn harvest");
  });
});
