// Issue 140: New menu's and Edit menu's server actions, through an InMemoryRepository with `next/headers` faked and
// `redirect` throwing as the real one does, as app/admin/weeks/actions.test.ts drives the weeks screen's. What a save
// may hold is checkMenu's and how a text is cleaned is menuText's (src/menus.test.ts); what is stored is the
// repository contract's (src/adapters/menu-contract.ts). These hold what each action does with them: what a failed
// save hands back, what a good one stores, where the admin lands, and that it writes as the admin.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Role } from "@core/members.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../../next-headers-fake";
import { redirectOf } from "../../screen-test-helpers";
import { addSupperClub, MENUS, SIZES } from "../subscribers-fixture";
import { createMenu, saveMenu } from "./actions";
import { MENU_NAME_FIELD, menuTextField, type MenuFormState } from "./shared";

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
    throw new Error("the menu actions send no email");
  },
  getSessionSecret: () => services.secret,
}));

const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const FEB_14 = "2027-02-14";
const BEFORE: MenuFormState = { name: "", texts: {}, errors: null };

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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function signInAs(role: Role): Promise<string> {
  const member = await services.repo.createMember({ email: "lenny@example.com", role });
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(Date.now() + DAY).toISOString() }, services.secret);
  return member.id;
}

/** The form as the browser posts it: the name, and each menu option's text by option name. */
const form = (name: string, texts: { Standard?: string; Vegan?: string }): FormData => {
  const data = new FormData();
  data.set(MENU_NAME_FIELD, name);
  if (texts.Standard !== undefined) data.set(menuTextField(standard), texts.Standard);
  if (texts.Vegan !== undefined) data.set(menuTextField(vegan), texts.Vegan);
  return data;
};

const GOOD = () => form("Autumn harvest", { Standard: "Squash soup\nRye bread", Vegan: "Lentil soup\nRye bread" });

/** A redirect's path and query, so a test does not depend on the order the parameters are written in. */
const landing = (url: string) => {
  const parsed = new URL(url, "http://haul.test");
  return { path: parsed.pathname, query: Object.fromEntries(parsed.searchParams) };
};

const library = () => services.repo.listMenus();

/** A menu already in the library, made through the repository. */
const autumn = () => services.repo.createMenu({ name: "Autumn harvest", texts: { [standard]: "Squash soup", [vegan]: "Lentil soup" } });

describe("AC4 — createMenu", () => {
  it("AC4: a name and a text for every menu option is a menu in the library, and the admin is back on the list with it saved", async () => {
    await signInAs("admin");
    const url = await redirectOf(createMenu(BEFORE, GOOD()));
    const menus = await library();
    expect(menus).toEqual([expect.objectContaining({ name: "Autumn harvest", texts: { [standard]: "Squash soup\nRye bread", [vegan]: "Lentil soup\nRye bread" } })]);
    expect(landing(url)).toEqual({ path: "/admin/menus", query: { saved: menus[0]?.id } });
  });

  it("AC4: no name hands back the name's error, with what was typed, and writes nothing", async () => {
    await signInAs("admin");
    const state = await createMenu(BEFORE, form("   ", { Standard: "Squash soup", Vegan: "Lentil soup" }));
    expect(state).toEqual({ name: "   ", texts: { [standard]: "Squash soup", [vegan]: "Lentil soup" }, errors: { name: "required", texts: {} } });
    expect(await library()).toEqual([]);
  });

  it("AC4: a text left out hands back that option's error, with everything exactly as typed — untrimmed, CRLF kept — and writes nothing", async () => {
    await signInAs("admin");
    const typed = form("  Autumn harvest  ", { Standard: "  Squash soup\r\nRye bread  \r\n", Vegan: "" });
    const state = await createMenu(BEFORE, typed);
    expect(state).toEqual({
      name: "  Autumn harvest  ",
      texts: { [standard]: "  Squash soup\r\nRye bread  \r\n", [vegan]: "" },
      errors: { texts: { [vegan]: "required" } },
    });
    expect(await library()).toEqual([]);
  });

  it("AC4: a text not posted at all is that option's error", async () => {
    await signInAs("admin");
    const state = await createMenu(BEFORE, form("Autumn harvest", { Standard: "Squash soup" }));
    expect(state.errors).toEqual({ texts: { [vegan]: "required" } });
    expect(await library()).toEqual([]);
  });
});

describe("AC6 — what a save stores", () => {
  it("AC6: each text is stored cleaned — CRLF as LF, the whole text's ends trimmed, the lines inside as typed — and the name trimmed", async () => {
    await signInAs("admin");
    await redirectOf(createMenu(BEFORE, form("  Autumn harvest ", { Standard: "\r\n  Squash soup  \r\n\r\nRye bread \r\n", Vegan: "Lentil soup" })));
    expect(await library()).toEqual([expect.objectContaining({ name: "Autumn harvest", texts: { [standard]: "Squash soup  \n\nRye bread", [vegan]: "Lentil soup" } })]);
  });
});

describe("AC5 — saveMenu", () => {
  it("AC5: it replaces the menu's name and texts, keeps it on its weeks, and the admin is back on the list with it saved", async () => {
    await signInAs("admin");
    const menu = await autumn();
    await services.repo.assignWeekMenu(product.id, FEB_14, menu.id);
    const url = await redirectOf(saveMenu(menu.id, BEFORE, form("Late autumn", { Standard: "Pumpkin soup", Vegan: "Bean soup" })));
    expect(landing(url)).toEqual({ path: "/admin/menus", query: { saved: menu.id } });
    expect(await library()).toEqual([expect.objectContaining({ id: menu.id, name: "Late autumn", texts: { [standard]: "Pumpkin soup", [vegan]: "Bean soup" } })]);
    expect(await services.repo.listWeekMenus(product.id, product.firstPickupDate)).toEqual(new Map([[FEB_14, menu.id]]));
  });

  it("AC5: a failed check hands back the errors with what was typed, and the menu stays as it was", async () => {
    await signInAs("admin");
    const menu = await autumn();
    const state = await saveMenu(menu.id, BEFORE, form("", { Standard: "Pumpkin soup", Vegan: "Bean soup" }));
    expect(state).toEqual({ name: "", texts: { [standard]: "Pumpkin soup", [vegan]: "Bean soup" }, errors: { name: "required", texts: {} } });
    expect(await services.repo.findMenu(menu.id)).toEqual(menu);
  });

  it.each([
    ["an unknown id", "00000000-0000-4000-8000-000000000000"],
    ["a string that isn't a UUID", "not-a-uuid"],
  ])("AC5: for %s it goes back to the list with no notice, and writes nothing", async (_what, id) => {
    await signInAs("admin");
    const menu = await autumn();
    const url = await redirectOf(saveMenu(id, BEFORE, form("Late autumn", { Standard: "Pumpkin soup", Vegan: "Bean soup" })));
    expect(landing(url)).toEqual({ path: "/admin/menus", query: {} });
    expect(await library()).toEqual([menu]);
  });
});

describe("AC7 — saving a duplicate", () => {
  it("AC7: a save from New menu filled from another menu is a new menu, on no week, and the original keeps its week", async () => {
    await signInAs("admin");
    const original = await autumn();
    await services.repo.assignWeekMenu(product.id, FEB_14, original.id);
    await redirectOf(createMenu(BEFORE, form("Autumn harvest (copy)", { Standard: "Squash soup", Vegan: "Lentil soup" })));
    const copy = (await library()).find((menu) => menu.id !== original.id);
    expect(copy).toMatchObject({ name: "Autumn harvest (copy)" });
    expect(await services.repo.listWeekMenus(product.id, product.firstPickupDate)).toEqual(new Map([[FEB_14, original.id]]));
  });
});

describe("AC14 — each save is the admin's", () => {
  it("AC14: createMenu writes as the admin, so the audit rows name the admin's member id as who acted", async () => {
    const adminId = await signInAs("admin");
    const withActor = vi.spyOn(services.repo, "withActor");
    await redirectOf(createMenu(BEFORE, GOOD()));
    expect(withActor).toHaveBeenCalledWith({ member: adminId }, expect.any(Function));
  });

  it("AC14: saveMenu writes as the admin", async () => {
    const adminId = await signInAs("admin");
    const menu = await autumn();
    const withActor = vi.spyOn(services.repo, "withActor");
    await redirectOf(saveMenu(menu.id, BEFORE, GOOD()));
    expect(withActor).toHaveBeenCalledWith({ member: adminId }, expect.any(Function));
  });
});

describe("AC13 — only an admin saves a menu", () => {
  it.each([
    ["a signed-in member whose role is not admin", "member" as const, "/"],
    ["a signed-out visitor", null, "/sign-in"],
  ])("AC13: %s posting either action lands where the other admin screens send them, and nothing is written", async (_who, role, where) => {
    if (role) await signInAs(role);
    const menu = await autumn();
    await expect(redirectOf(createMenu(BEFORE, GOOD()))).resolves.toBe(where);
    await expect(redirectOf(saveMenu(menu.id, BEFORE, form("Late autumn", { Standard: "Pumpkin soup", Vegan: "Bean soup" })))).resolves.toBe(where);
    expect(await library()).toEqual([menu]);
  });
});
