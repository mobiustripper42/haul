// Issue 140: New menu, /admin/menus/new, and Duplicate's /admin/menus/new?from=<menu id>, rendered through
// react-dom/server with `next/headers` faked and the composition root mocked, as ../page.test.ts renders the library.
// Read as its markup, and for the errors only a failed save shows, as the tree it returns: what it gives `MenuForm`.
// The form's own markup is ../menu-form.test.ts's; what a save does is ../actions.test.ts's. The wording is new copy,
// typed here once.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Menu } from "@core/menus.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { LANGUAGE_COOKIE } from "../../../language";
import { emptyRequest } from "../../../next-headers-fake";
import { attributesOf, findAll, screenMarkup, textsOf } from "../../../screen-test-helpers";
import { addSupperClub, MENUS, SIZES } from "../../subscribers-fixture";
import { createMenu } from "../actions";
import { MenuForm } from "../menu-form";
import { MENU_NAME_FIELD, menuTextField } from "../shared";
import NewMenu from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("New menu has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;

let product: ProductWithOptions;

const setUp = (menuOptions = MENUS.options) => {
  product = addSupperClub(services.repo, { optionTypes: [SIZES, { ...MENUS, menuTexts: true, options: menuOptions }] });
};

/** The menu options' ids, by name. */
const idOf = (name: string): string => product.optionTypes.find((type) => type.name === MENUS.name)?.options.find((option) => option.name === name)?.id ?? `no ${name}`;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  const admin = await services.repo.createMember({ email: "lenny@example.com", role: "admin" });
  request.current.cookies.ocf_session = signSession({ subjectId: admin.id, expiresAt: new Date(NOW.getTime() + DAY).toISOString() }, services.secret);
});

afterEach(() => {
  vi.useRealTimers();
});

const pageOf = (query: Record<string, string> = {}) => NewMenu({ searchParams: Promise.resolve(query) });
const render = async (query: Record<string, string> = {}) => renderToStaticMarkup(await pageOf(query));

const nameValue = (html: string) => attributesOf(html, "input").find((input) => input.name === MENU_NAME_FIELD)?.value ?? "";

/** Each textarea: its name and its text. */
const textareas = (html: string): { name: string; value: string }[] =>
  [...screenMarkup(html).matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)].map(([, attrs = "", inner = ""]) => ({
    name: /\bname="([^"]*)"/.exec(attrs)?.[1] ?? "",
    value: inner,
  }));

const linksOf = (html: string) =>
  [...screenMarkup(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    href: attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "",
    text: textsOf(inner).join(" "),
    current: /\baria-current="page"/.test(attrs),
  }));

const autumn = (): Promise<Menu> =>
  services.repo.createMenu({ name: "Autumn harvest", texts: { [idOf("Standard")]: "Squash soup\n\nRye bread", [idOf("Vegan")]: "Lentil soup" } });

describe("AC4 — New menu", () => {
  it("AC4: Menus is the page showing, and All menus goes back to the library", async () => {
    setUp();
    const links = linksOf(await render());
    expect(links).toContainEqual({ href: "/admin/menus", text: "Menus", current: true });
    expect(links).toContainEqual(expect.objectContaining({ href: "/admin/menus", text: "All menus" }));
  });

  it("AC4: an empty name, then a text field per menu option, in option order, each labelled with its option", async () => {
    setUp();
    const html = await render();
    expect(nameValue(html)).toBe("");
    expect(textsOf(html).filter((text) => text.endsWith(" menu") && text !== "New menu")).toEqual(["Standard menu", "Vegan menu"]);
    expect(textareas(html)).toEqual([
      { name: menuTextField(idOf("Standard")), value: "" },
      { name: menuTextField(idOf("Vegan")), value: "" },
    ]);
  });

  it("AC4: a third option on the menu option type is a third field, with no code change", async () => {
    setUp([...MENUS.options, { name: "Spicy", priceCents: 0, position: 3 }]);
    const html = await render();
    expect(textareas(html).map((area) => area.name)).toEqual(["Standard", "Vegan", "Spicy"].map((name) => menuTextField(idOf(name))));
    expect(textsOf(html)).toContain("Spicy menu");
  });

  it("AC4: the form posts to createMenu, and gets each field's error from the catalog", async () => {
    setUp();
    const [form, ...others] = findAll(await pageOf(), MenuForm);
    expect(others).toEqual([]);
    expect(form?.props.action).toBe(createMenu);
    expect(form?.props.text).toMatchObject({
      textLabel: "{option} menu",
      errors: {
        nameRequired: "Give the menu a name.",
        nameTooLong: "Keep the name to 100 characters.",
        textRequired: "Write the {option} menu, one dish per line.",
        textTooLong: "Keep the {option} menu to 4,000 characters.",
      },
    });
  });

  it("AC4: New menu has no Assigned line: a menu not yet saved is on no week", async () => {
    setUp();
    const texts = textsOf(await render());
    expect(texts.filter((text) => text.startsWith("Assigned to") || text === "Not assigned to a week")).toEqual([]);
  });
});

describe("AC7 — Duplicate", () => {
  it("AC7: ?from=<menu id> opens New menu holding the menu's name with \" (copy)\" added, and every text", async () => {
    setUp();
    const original = await autumn();
    const html = await render({ from: original.id });
    expect(nameValue(html)).toBe("Autumn harvest (copy)");
    expect(textareas(html).map((area) => area.value)).toEqual(["Squash soup\n\nRye bread", "Lentil soup"]);
  });

  it("AC7: in the admin's language: in Spanish the name gains Spanish words, not \" (copy)\"", async () => {
    setUp();
    request.current.cookies[LANGUAGE_COOKIE] = "es";
    const original = await autumn();
    const name = nameValue(await render({ from: original.id }));
    expect(name.startsWith("Autumn harvest")).toBe(true);
    expect(name.length).toBeGreaterThan("Autumn harvest".length);
    expect(name).not.toBe("Autumn harvest (copy)");
  });

  it("AC7: opening it writes nothing: the library holds the original alone", async () => {
    setUp();
    const original = await autumn();
    await render({ from: original.id });
    expect(await services.repo.listMenus()).toEqual([original]);
  });

  it.each([
    ["an unknown id", "00000000-0000-4000-8000-000000000000"],
    ["a string that isn't a UUID", "not-a-uuid"],
  ])("AC7: ?from= %s opens New menu empty", async (_what, from) => {
    setUp();
    await autumn();
    const html = await render({ from });
    expect(textsOf(html)).toContain("Standard menu");
    expect(nameValue(html)).toBe("");
    expect(textareas(html).map((area) => area.value)).toEqual(["", ""]);
  });
});
