// Issue 140, AC1 and AC3: the library's list, `MenusList` rendered through react-dom/server with the menus it is
// given and a stand-in for the words the page translates, as app/admin/members-list.test.ts renders MembersList.
// What the page gives it (which menus, in which order, their "Assigned to" lines and the catalog's words) is
// ./page.test.ts's; what the search matches is filterMenus' (src/menus.test.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Menu } from "@core/menus.js";
import { attributesOf, textsOf } from "../../screen-test-helpers";
import { MenusList, type MenusListText } from "./menus-list";

const TEXT: MenusListText = { search: "Find a menu", searchPlaceholder: "Type to find", noMatch: 'None for "{q}"', edit: "Change it", duplicate: "Copy it" };

const STANDARD = "option-standard";
const VEGAN = "option-vegan";

const menu = (id: string, name: string, standard: string, vegan: string): Menu => ({
  id,
  name,
  texts: { [STANDARD]: standard, [VEGAN]: vegan },
  updatedAt: new Date("2027-02-01T12:00:00.000Z"),
});

const AUTUMN = menu("11111111-1111-4111-8111-111111111111", "Autumn harvest", "Squash soup\n\nRye bread  \nApple cake", "Lentil soup\nRye bread");
const WINTER = menu("22222222-2222-4222-8222-222222222222", "Winter roots", "Beef stew\nPotato rolls", "Mushroom stew\nPotato rolls");

const ASSIGNED = { [AUTUMN.id]: "On two weeks", [WINTER.id]: "On no week" };

const render = (menus: Menu[], query?: string) =>
  renderToStaticMarkup(createElement(MenusList, { menus, firstOption: STANDARD, assigned: ASSIGNED, text: TEXT, ...(query === undefined ? {} : { query }) }));

/** Each link: where it goes, as a path and query, and its text. */
const linksOf = (html: string): { path: string; query: Record<string, string>; text: string }[] =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => {
    const url = new URL(attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "", "http://haul.test/admin/menus");
    return { path: url.pathname, query: Object.fromEntries(url.searchParams), text: textsOf(inner).join(" ") };
  });

const searchBox = (html: string) => attributesOf(html, "input").filter((input) => input.type === "search");

describe("AC1 — the rows", () => {
  it("AC1: each menu, in the order given: its name, its first option's text on one line, its Assigned line, Edit and Duplicate", () => {
    const texts = textsOf(render([WINTER, AUTUMN]));
    const wanted = [
      "Winter roots",
      "Beef stew · Potato rolls",
      "On no week",
      TEXT.edit,
      TEXT.duplicate,
      "Autumn harvest",
      "Squash soup · Rye bread · Apple cake",
      "On two weeks",
      TEXT.edit,
      TEXT.duplicate,
    ];
    expect(texts.filter((text) => wanted.includes(text))).toEqual(wanted);
  });

  it("AC1: the line is the first option's text, not another's", () => {
    expect(textsOf(render([AUTUMN]))).not.toContain("Lentil soup · Rye bread");
  });

  it("AC1, AC7: Edit opens the menu's editor and Duplicate opens New menu from it", () => {
    const links = linksOf(render([AUTUMN]));
    expect(links).toContainEqual({ path: `/admin/menus/${AUTUMN.id}`, query: {}, text: TEXT.edit });
    expect(links).toContainEqual({ path: "/admin/menus/new", query: { from: AUTUMN.id }, text: TEXT.duplicate });
  });
});

describe("AC3 — the search", () => {
  it("AC3: with no query the box opens empty, holding the placeholder, and every menu is listed", () => {
    const html = render([AUTUMN, WINTER]);
    const [box, ...others] = searchBox(html);
    expect(others).toEqual([]);
    expect(box?.value ?? "").toBe("");
    expect(box?.placeholder).toBe(TEXT.searchPlaceholder);
    expect(textsOf(html)).toEqual(expect.arrayContaining([TEXT.search, "Autumn harvest", "Winter roots"]));
  });

  it("AC3: a query lists only the menus it matches, the box holding it", () => {
    const html = render([AUTUMN, WINTER], "mushroom");
    expect(searchBox(html)[0]?.value).toBe("mushroom");
    expect(textsOf(html)).toContain("Winter roots");
    expect(textsOf(html)).not.toContain("Autumn harvest");
    expect(textsOf(html)).not.toContain('None for "mushroom"');
  });

  it("AC3: a query that matches nothing says so, with the query, and lists no menu", () => {
    const texts = textsOf(render([AUTUMN, WINTER], "risotto"));
    expect(texts).toContain('None for "risotto"');
    expect(texts).not.toContain("Autumn harvest");
    expect(texts).not.toContain("Winter roots");
  });
});
