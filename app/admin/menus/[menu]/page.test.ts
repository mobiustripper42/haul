// Issue 140: Edit menu, /admin/menus/<id>, rendered through react-dom/server with `next/headers` faked and the
// composition root mocked, as ../page.test.ts renders the library; `notFound` throws as the real one does, as
// app/admin/members/[subscription]/page.test.ts has it. The form's own markup is ../menu-form.test.ts's and what a
// save does ../actions.test.ts's; the Assigned line's wording is ../assigned.test.ts's. The wording is new copy.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Menu } from "@core/menus.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../../../next-headers-fake";
import { attributesOf, findAll, redirectOf, screenMarkup, textsOf } from "../../../screen-test-helpers";
import { addSupperClub, MENUS, SIZES } from "../../subscribers-fixture";
import { MenuForm } from "../menu-form";
import { MENU_NAME_FIELD, menuTextField, type MenuFormState } from "../shared";
import EditMenu from "./page";

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
vi.mock("next/navigation", async () => ({
  redirect: (await import("../../../screen-test-helpers")).throwingRedirect,
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("Edit menu has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

// Wednesday, February 3, 2027, noon in Cleveland: the calendar lists February 7 to April 25.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const FEB_14 = "2027-02-14";

let product: ProductWithOptions;
let standard: string;
let vegan: string;
let menu: Menu;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  product = addSupperClub(services.repo, { optionTypes: [SIZES, { ...MENUS, menuTexts: true }] });
  const options = product.optionTypes.find((type) => type.name === MENUS.name)?.options ?? [];
  standard = options.find((option) => option.name === "Standard")?.id ?? "no standard";
  vegan = options.find((option) => option.name === "Vegan")?.id ?? "no vegan";
  const admin = await services.repo.createMember({ email: "lenny@example.com", role: "admin" });
  request.current.cookies.ocf_session = signSession({ subjectId: admin.id, expiresAt: new Date(NOW.getTime() + DAY).toISOString() }, services.secret);
  menu = await services.repo.createMenu({ name: "Autumn harvest", texts: { [standard]: "Squash soup\n\nRye bread", [vegan]: "Lentil soup" } });
});

afterEach(() => {
  vi.useRealTimers();
});

const pageOf = (id: string) => EditMenu({ params: Promise.resolve({ menu: id }) });
const render = async (id: string) => renderToStaticMarkup(await pageOf(id));

/** True when the page was Next's not-found. */
const notFoundOf = async (pending: Promise<unknown>): Promise<boolean> => {
  try {
    await pending;
  } catch (e) {
    if ((e as { notFound?: unknown } | null)?.notFound === true) return true;
    throw e;
  }
  return false;
};

/** Each textarea's text, in order. */
const textareaValues = (html: string): string[] => [...screenMarkup(html).matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/g)].map(([, inner = ""]) => inner);

const linksOf = (html: string) =>
  [...screenMarkup(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    href: attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "",
    text: textsOf(inner).join(" "),
    current: /\baria-current="page"/.test(attrs),
  }));

describe("Interfaces — a menu the library does not hold is not found", () => {
  it.each([
    ["an unknown id", "00000000-0000-4000-8000-000000000000"],
    ["a string that isn't a UUID", "not-a-uuid"],
  ])("AC5: %s is the not-found page", async (_what, id) => {
    await expect(notFoundOf(pageOf(id))).resolves.toBe(true);
  });
});

describe("AC5 — Edit menu", () => {
  it("AC5: Menus is the page showing, All menus goes back to the library, and the fields hold the menu's name and texts", async () => {
    const html = await render(menu.id);
    const links = linksOf(html);
    expect(links).toContainEqual({ href: "/admin/menus", text: "Menus", current: true });
    expect(links).toContainEqual(expect.objectContaining({ href: "/admin/menus", text: "All menus" }));
    expect(attributesOf(html, "input").find((input) => input.name === MENU_NAME_FIELD)?.value).toBe("Autumn harvest");
    expect(textareaValues(html)).toEqual(["Squash soup\n\nRye bread", "Lentil soup"]);
    expect(textsOf(html)).toEqual(expect.arrayContaining(["Standard menu", "Vegan menu"]));
  });

  it("AC5: a menu on a week shows the weeks it is on, then how to assign it", async () => {
    await services.repo.assignWeekMenu(product.id, FEB_14, menu.id);
    const texts = textsOf(await render(menu.id));
    const wanted = ["Assigned to February 14 and 15", "Assign menus to weeks under Weeks."];
    expect(texts.filter((text) => wanted.includes(text))).toEqual(wanted);
  });

  it("AC5: a menu on no week says so", async () => {
    expect(textsOf(await render(menu.id))).toContain("Not assigned to a week");
  });

  it("AC5: the form's save is saveMenu for this menu: what it posts replaces this menu and lands on the list with it saved", async () => {
    const [form] = findAll(await pageOf(menu.id), MenuForm);
    const save = form?.props.action as ((state: MenuFormState, formData: FormData) => Promise<MenuFormState>) | undefined;
    expect(save).toBeTypeOf("function");
    const data = new FormData();
    data.set(MENU_NAME_FIELD, "Late autumn");
    data.set(menuTextField(standard), "Pumpkin soup");
    data.set(menuTextField(vegan), "Bean soup");
    await expect(redirectOf(save?.({ name: "", texts: {}, errors: null }, data) ?? Promise.resolve())).resolves.toBe(`/admin/menus?saved=${menu.id}`);
    expect(await services.repo.findMenu(menu.id)).toMatchObject({ name: "Late autumn", texts: { [standard]: "Pumpkin soup", [vegan]: "Bean soup" } });
  });

  it("AC7: Duplicate is on the list only: the editor has none", async () => {
    const html = await render(menu.id);
    expect(textsOf(html)).not.toContain("Duplicate");
    expect(linksOf(html).filter((link) => link.href.includes("from="))).toEqual([]);
  });
});
