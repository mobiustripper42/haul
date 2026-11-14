// Issue 140: the menu library's rules, each tested here once, at the layer that owns it: a text's cleaning
// (`menuText`), the save check (`checkMenu`), the editor's fields (`menuOptions`), which weeks a menu is on
// (`assignedWeeks`), the search (`filterMenus`) and a row's one-line text (`menuLine`). The actions, pages and
// adapters that use them check one accepted and one refused case through them.
import { describe, expect, it } from "vitest";
import { assignedWeeks, checkMenu, filterMenus, menuLine, menuLines, menuOptions, menuSections, menuText, type Menu } from "./menus.js";
import { upcomingWeeks, type ChangedWeek } from "./pickup-week.js";
import type { ProductOption, ProductWithOptions } from "./products.js";

const STANDARD: ProductOption = { id: "option-standard", name: "Standard", priceCents: 0, position: 1 };
const VEGAN: ProductOption = { id: "option-vegan", name: "Vegan", priceCents: 0, position: 2 };

const product = (over: Partial<ProductWithOptions> = {}): ProductWithOptions => ({
  id: "product-1",
  name: "Supper Club",
  cap: 50,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes: [
    {
      id: "type-size",
      name: "How many people",
      position: 1,
      menuTexts: false,
      options: [
        { id: "option-four", name: "Portioned for 4", priceCents: 7400, position: 1 },
        { id: "option-two", name: "Portioned for 2", priceCents: 4200, position: 2 },
      ],
    },
    { id: "type-menu", name: "Which menu", position: 2, menuTexts: true, options: [STANDARD, VEGAN] },
  ],
  ...over,
});

describe("AC6 — menuText", () => {
  it("AC6: CRLF is saved as LF", () => {
    expect(menuText("Squash soup\r\nRye bread\r\nApple cake")).toBe("Squash soup\nRye bread\nApple cake");
  });

  it("AC6: the start and end of the whole text are trimmed", () => {
    expect(menuText("  \r\n  Squash soup\nRye bread  \n\n  ")).toBe("Squash soup\nRye bread");
  });

  it("AC6: spaces at the end of a line inside it, and blank lines between dishes, stay as typed", () => {
    expect(menuText("Squash soup  \r\n\r\n\r\n  Rye bread\nApple cake")).toBe("Squash soup  \n\n\n  Rye bread\nApple cake");
  });
});

describe("AC4 — checkMenu", () => {
  const OPTIONS = [STANDARD, VEGAN];
  const both = { [STANDARD.id]: "Squash soup", [VEGAN.id]: "Lentil soup" };

  it("AC4: a name and a text for every menu option has no errors", () => {
    expect(checkMenu({ name: "Autumn harvest", texts: both }, OPTIONS)).toEqual({ texts: {} });
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
  ])("AC4: a name left %s is required", (_what, name) => {
    expect(checkMenu({ name, texts: both }, OPTIONS)).toEqual({ name: "required", texts: {} });
  });

  it("AC4: a name of 100 characters passes, with trailing spaces too; 101 is too long", () => {
    expect(checkMenu({ name: `${"a".repeat(100)}   `, texts: both }, OPTIONS)).toEqual({ texts: {} });
    expect(checkMenu({ name: "a".repeat(101), texts: both }, OPTIONS)).toEqual({ name: "tooLong", texts: {} });
  });

  it.each([
    ["missing", {}],
    ["empty", { [VEGAN.id]: "" }],
    ["only spaces and line breaks", { [VEGAN.id]: "  \r\n  \n " }],
  ])("AC4: a text %s is required, under its option's id", (_what, vegan) => {
    expect(checkMenu({ name: "Autumn harvest", texts: { [STANDARD.id]: "Squash soup", ...vegan } }, OPTIONS)).toEqual({ texts: { [VEGAN.id]: "required" } });
  });

  it("AC4: a text of 4,000 characters passes, with trailing spaces too; 4,001 is too long", () => {
    expect(checkMenu({ name: "Autumn harvest", texts: { ...both, [VEGAN.id]: `${"a".repeat(4000)}   ` } }, OPTIONS)).toEqual({ texts: {} });
    expect(checkMenu({ name: "Autumn harvest", texts: { ...both, [VEGAN.id]: "a".repeat(4001) } }, OPTIONS)).toEqual({ texts: { [VEGAN.id]: "tooLong" } });
  });

  it("AC4: a text is measured after menuText, so a CRLF counts as one character", () => {
    // 4,002 characters typed; cleaned, "ab\n" × 1,000 then "ab" is 3,002.
    const lines = "ab\r\n".repeat(1000);
    expect(lines.length).toBe(4000);
    expect(checkMenu({ name: "Autumn harvest", texts: { ...both, [VEGAN.id]: `${lines}ab` } }, OPTIONS)).toEqual({ texts: {} });
  });

  it("AC4: every field at fault is reported at once", () => {
    expect(checkMenu({ name: "", texts: {} }, OPTIONS)).toEqual({ name: "required", texts: { [STANDARD.id]: "required", [VEGAN.id]: "required" } });
  });
});

describe("AC4 — menuOptions", () => {
  it("AC4: the options of the type marked menuTexts, in position order", () => {
    const reversed = product();
    const menuType = reversed.optionTypes[1];
    if (menuType) menuType.options = [VEGAN, STANDARD];
    expect(menuOptions(reversed)).toEqual([STANDARD, VEGAN]);
  });

  it("AC4: a third option on the marked type is a third field, with no code change", () => {
    const spicy: ProductOption = { id: "option-spicy", name: "Spicy", priceCents: 0, position: 3 };
    const three = product();
    const menuType = three.optionTypes[1];
    if (menuType) menuType.options = [STANDARD, VEGAN, spicy];
    expect(menuOptions(three).map((option) => option.name)).toEqual(["Standard", "Vegan", "Spicy"]);
  });

  it("AC4: with no type marked there are none", () => {
    const unmarked = product();
    for (const type of unmarked.optionTypes) type.menuTexts = false;
    expect(menuOptions(unmarked)).toEqual([]);
  });

  it("AC4: a type with no menuTexts at all reads as unmarked", () => {
    const absent = product();
    for (const type of absent.optionTypes) delete type.menuTexts;
    expect(menuOptions(absent)).toEqual([]);
  });
});

describe("AC1 — assignedWeeks", () => {
  // Wednesday, February 3, 2027, noon in Cleveland: the calendar lists February 7 to April 25.
  const NOW = new Date("2027-02-03T17:00:00.000Z");
  const closed = (weekOf: string): ChangedWeek => ({ weekOf, closedAt: new Date("2027-02-02T15:00:00.000Z"), note: null, firstDay: null, lastDay: null });

  it("AC1: the weeks given that hold the menu, in the order given", () => {
    const weeks = upcomingWeeks(product(), NOW, []);
    const menus = new Map([
      ["2027-02-21", "autumn"],
      ["2027-02-07", "autumn"],
      ["2027-02-14", "winter"],
    ]);
    expect(assignedWeeks("autumn", weeks, menus).map((week) => week.weekOf)).toEqual(["2027-02-07", "2027-02-21"]);
  });

  it("AC1: a closed week is left out, and comes back once it is open", () => {
    const menus = new Map([
      ["2027-02-07", "autumn"],
      ["2027-02-14", "autumn"],
    ]);
    expect(assignedWeeks("autumn", upcomingWeeks(product(), NOW, [closed("2027-02-14")]), menus).map((week) => week.weekOf)).toEqual(["2027-02-07"]);
    expect(assignedWeeks("autumn", upcomingWeeks(product(), NOW, []), menus).map((week) => week.weekOf)).toEqual(["2027-02-07", "2027-02-14"]);
  });

  it("AC1: a menu whose only week is closed is on none", () => {
    const weeks = upcomingWeeks(product(), NOW, [closed("2027-02-14")]);
    expect(assignedWeeks("autumn", weeks, new Map([["2027-02-14", "autumn"]]))).toEqual([]);
  });

  it("AC1: a week the calendar no longer lists, its pickup passed, is not among them", () => {
    const weeks = upcomingWeeks(product(), NOW, []);
    expect(assignedWeeks("autumn", weeks, new Map([["2027-01-31", "autumn"]]))).toEqual([]);
  });
});

describe("AC3 — filterMenus", () => {
  const menu = (id: string, name: string, texts: Record<string, string>): Menu => ({ id, name, texts, updatedAt: new Date("2027-02-01T12:00:00.000Z") });
  const AUTUMN = menu("autumn", "Autumn Harvest", { [STANDARD.id]: "Squash soup\nRye bread", [VEGAN.id]: "Lentil soup\nRye bread" });
  const WINTER = menu("winter", "Winter Roots", { [STANDARD.id]: "Beef stew\nPotato rolls", [VEGAN.id]: "Mushroom stew\nPotato rolls" });
  const SPRING = menu("spring", "Spring Greens", { [STANDARD.id]: "Pea soup", [VEGAN.id]: "Nettle soup" });
  const ALL = [AUTUMN, WINTER, SPRING];

  it("AC3: a name matches, ignoring case", () => {
    expect(filterMenus(ALL, "wInTeR")).toEqual([WINTER]);
  });

  it("AC3: any of a menu's texts matches, the first option's or another's, ignoring case", () => {
    expect(filterMenus(ALL, "lentil")).toEqual([AUTUMN]);
    expect(filterMenus(ALL, "SOUP")).toEqual([AUTUMN, SPRING]);
  });

  it("AC3: the query is trimmed, and the menus keep the order given", () => {
    expect(filterMenus([SPRING, WINTER, AUTUMN], "  stew ")).toEqual([WINTER]);
    expect(filterMenus([SPRING, AUTUMN], " soup ")).toEqual([SPRING, AUTUMN]);
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
  ])("AC3: a query left %s lists every menu", (_what, query) => {
    expect(filterMenus(ALL, query)).toEqual(ALL);
  });

  it("AC3: a query that matches nothing lists none", () => {
    expect(filterMenus(ALL, "risotto")).toEqual([]);
  });
});

describe("AC1 — menuLine", () => {
  it("AC1: the non-blank lines, each trimmed, joined with ' · '", () => {
    expect(menuLine("  Squash soup  \n\n   \nRye bread\n Apple cake ")).toBe("Squash soup · Rye bread · Apple cake");
  });

  it("AC1: one dish is itself", () => {
    expect(menuLine("Squash soup")).toBe("Squash soup");
  });
});

// Issue 141: a menu text's lines, the one home the list's menuLine, the menu email and the menu page share, and the
// sections the email and the page both draw from a menu. The email and the page take one case each through them.
describe("AC5, AC7 (issue 141) — menuLines", () => {
  it("AC5: the non-blank lines, each trimmed, in order", () => {
    expect(menuLines("  Squash soup  \n\n   \nRye bread\n Apple cake ")).toEqual(["Squash soup", "Rye bread", "Apple cake"]);
  });

  it("AC5: one dish is one line", () => {
    expect(menuLines("Squash soup")).toEqual(["Squash soup"]);
  });

  it("AC5: a text of only spaces and line breaks has no lines", () => {
    expect(menuLines("  \n \n")).toEqual([]);
  });
});

describe("AC5, AC7 (issue 141) — menuSections", () => {
  const menu = (texts: Record<string, string>): Menu => ({ id: "autumn", name: "Autumn harvest", texts, updatedAt: new Date("2027-02-01T12:00:00.000Z") });

  it("AC5: one section per menu option, in position order, each the option's name and its text's lines", () => {
    const reversed = product();
    const menuType = reversed.optionTypes[1];
    if (menuType) menuType.options = [VEGAN, STANDARD];
    const autumn = menu({ [VEGAN.id]: "Lentil soup\n\n  Rye bread ", [STANDARD.id]: "Squash soup\nRye bread" });
    expect(menuSections(reversed, autumn)).toEqual([
      { name: "Standard", lines: ["Squash soup", "Rye bread"] },
      { name: "Vegan", lines: ["Lentil soup", "Rye bread"] },
    ]);
  });

  it("AC5: an option the menu holds no text for is still a section, with no lines", () => {
    expect(menuSections(product(), menu({ [STANDARD.id]: "Squash soup" }))).toEqual([
      { name: "Standard", lines: ["Squash soup"] },
      { name: "Vegan", lines: [] },
    ]);
  });

  it("AC5: a text for an option that is not a menu option is not a section", () => {
    expect(menuSections(product(), menu({ [STANDARD.id]: "Squash soup", [VEGAN.id]: "Lentil soup", "option-four": "Four of everything" })).map((section) => section.name)).toEqual([
      "Standard",
      "Vegan",
    ]);
  });
});
