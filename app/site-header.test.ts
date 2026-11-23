// Issue 55, AC17 and AC18: the header moved out of app/sign-in/layout.tsx. `await SiteHeader(props)` is read
// as the tree it returns, and as markup for the order of its words, with `next/headers` faked.
// Issue 77, AC4 and AC5: the link goes to the sign-in pane and can be marked current.
// Issue 97, AC3–AC6: the header reads the session itself. Signed out it is as each page sets it with
// `account`; signed in it shows the account links and Sign out (and the Admin group for admins), whatever `account` says.
// Issue 159 (which replaces issue 155's row and Menu): signed in, the links are drawn twice from one list: in the bar,
// shown at 1024px and wider, and in the MenuDrawer, shown below it. "The bar" is the tree with the MenuDrawer taken out;
// "the drawer" is the MenuDrawer's `children` and its `foot`, which the header builds. The admin links sit in the bar's
// MenuGroup, and in the drawer openly under an Eyebrow. Which one a width shows is measured in the browser
// (e2e/account-nav.spec.ts); `aria-current` is Button's (components/ui/button.test.ts) and `data-active` MenuGroup's
// (components/ui/menu-group.test.ts), so here it is what the header hands them.
// Issue 187, AC3: the header has no language switch, signed in or out, on any page. The session is faked as a
// member or an admin; who counts as signed in is app/session.test.ts's. The wide-only wrapper for issue 77's
// AC11 ("below `lg`") is measured in the browser, e2e/supper-club.spec.ts.
import { cloneElement, createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LANGUAGES } from "@core/i18n.js";
import { Button } from "../components/ui/button";
import { Eyebrow } from "../components/ui/eyebrow";
import { MenuDrawer } from "../components/ui/menu-drawer";
import { MenuGroup } from "../components/ui/menu-group";
import { MenuScript } from "../components/ui/menu-script";
import { SiteBar } from "../components/ui/site-bar";
import { emptyRequest } from "./next-headers-fake";
import { ACCOUNT_PATH, ADMIN_LISTS_PATH, ADMIN_MENUS_PATH, ADMIN_PATH, ADMIN_WEEKS_PATH } from "./paths";
import { attributesOf, findAll, textsOf } from "./screen-test-helpers";
import { SiteHeader } from "./site-header";
import { signOut } from "./sign-in/actions";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
const session = vi.hoisted(() => ({ member: null as null | { role: "member" | "admin" } }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("./screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("./services", () => ({ getRepository: () => undefined, getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789" }));
vi.mock("./session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  getSignedInMember: async () => session.member,
}));

beforeEach(() => {
  request.current = emptyRequest();
  session.member = null;
});

const SIGN_IN_PATH = "/supper-club/sign-in";
const WEEKS_PATH = "/account/weeks";
const HISTORY_PATH = "/account/history";
/** The account links' destinations, in order: the bar's and the drawer's. Issue 219: Your details went into Your account. */
const LINKS = [ACCOUNT_PATH, WEEKS_PATH, HISTORY_PATH];
/** Issue 159, AC2: the admin links' destinations, in order: Members, Menus, Weeks, Weekly lists. */
const ADMIN_LINKS = [ADMIN_PATH, ADMIN_MENUS_PATH, ADMIN_WEEKS_PATH, ADMIN_LISTS_PATH];
/** Sign out, in a sequence of buttons: the one with no destination, a submit. */
const SIGN_OUT = "submit";
const LANGUAGE_NAMES: string[] = Object.values(LANGUAGES).map((language) => language.name);

type Account = "none" | "sign-in" | "sign-in-current";
type Current = "account" | "weeks" | "history" | "admin-members" | "admin-menus" | "admin-weeks" | "admin-lists";

/**
 * Components read as themselves; every other function component is called through, so what it draws is read too.
 * MenuScript is a client component, kept so it is never called outside React.
 */
const KEPT = new Set<unknown>([Button, SiteBar, MenuDrawer, MenuGroup, MenuScript, Eyebrow]);

const expand = (node: ReactNode): ReactNode => {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  if (typeof node.type === "function" && !KEPT.has(node.type)) return expand((node.type as (props: unknown) => ReactNode)(node.props));
  if (node.props.children === undefined) return node;
  const children = expand(node.props.children as ReactNode);
  return cloneElement(node, undefined, ...(Array.isArray(children) ? children : [children]));
};

/** The tree with every MenuDrawer taken out: the bar. */
const withoutDrawer = (node: ReactNode): ReactNode => {
  if (Array.isArray(node)) return node.map(withoutDrawer);
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  if (node.type === MenuDrawer) return null;
  if (node.props.children === undefined) return node;
  const children = withoutDrawer(node.props.children as ReactNode);
  return cloneElement(node, undefined, ...(Array.isArray(children) ? children : [children]));
};

const wordsOf = (...nodes: ReactNode[]): string[] => textsOf(renderToStaticMarkup(createElement(Fragment, null, ...nodes)));

const header = async (account: Account, current?: Current, wideOnly?: boolean) => {
  const element = await SiteHeader({ account, ...(current === undefined ? {} : { current }), ...(wideOnly ? { wideOnly } : {}) });
  const tree = expand(element);
  const bar = withoutDrawer(tree);
  const drawers = findAll(tree, MenuDrawer);
  const links = expand(drawers[0]?.props.children as ReactNode);
  const foot = expand(drawers[0]?.props.foot as ReactNode);
  return {
    element,
    tree,
    words: wordsOf(bar),
    buttons: findAll(bar, Button),
    forms: findAll(bar, "form"),
    groups: findAll(bar, MenuGroup),
    drawers,
    drawer: {
      words: wordsOf(links, foot),
      buttons: [...findAll(links, Button), ...findAll(foot, Button)],
      forms: [...findAll(links, "form"), ...findAll(foot, "form")],
      links: { node: links, buttons: findAll(links, Button), forms: findAll(links, "form") },
      foot: { buttons: findAll(foot, Button), forms: findAll(foot, "form") },
    },
  };
};

type Buttons = ReactElement<Record<string, unknown>>[];
const linkTo = (buttons: Buttons, href: string) => buttons.find((button) => button.props.href === href);
/** The buttons in order, each as its destination, or its type for one that submits. */
const sequence = (buttons: Buttons) => buttons.map((button) => button.props.href ?? button.props.type);
/** The Buttons inside a MenuGroup, in order. */
const inGroup = (group: ReactElement<Record<string, unknown>> | undefined): Buttons => findAll(group?.props.children as ReactNode, Button);

/** Every element in document order. */
const elementsOf = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child as ReactNode));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elementsOf(node.props.children as ReactNode)];
};
/** In document order: each Button as its destination (or type), each Eyebrow as "heading", each MenuGroup as "group". */
const marks = (node: ReactNode): unknown[] =>
  elementsOf(node)
    .map((element) =>
      element.type === Button ? (element.props.href ?? element.props.type) : element.type === Eyebrow ? "heading" : element.type === MenuGroup ? "group" : null,
    )
    .filter((mark) => mark !== null);

describe("AC18 — SiteHeader, account none, is the header the sign-in screens had", () => {
  // Issue 245: the wordmark is drawn by Wordmark, a next/link, so its link is read in the markup, not the tree.
  it("AC18: the farm's name is the one link, and it goes to /", async () => {
    const { element } = await header("none");
    expect(attributesOf(renderToStaticMarkup(element), "a").map((link) => link.href)).toEqual(["/"]);
  });

  it("AC18: it has no button", async () => {
    expect((await header("none")).buttons).toEqual([]);
  });
});

describe("AC3 (issue 97) — the header's frame", () => {
  it("AC3: SiteHeader renders through SiteBar, as the header", async () => {
    const { element } = await header("none");
    expect(findAll(element, SiteBar).map((bar) => bar.props.as)).toEqual(["header"]);
  });
});

describe("AC17 — SiteHeader's account link", () => {
  it('AC17, AC4 (issue 77): account "sign-in" adds a secondary "Sign in" link to /supper-club/sign-in after the wordmark', async () => {
    const { buttons } = await header("sign-in");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props).toMatchObject({ kind: "secondary", href: SIGN_IN_PATH });
  });

  it("AC17: the Sign in link is not marked as the page showing", async () => {
    expect((await header("sign-in")).buttons[0]?.props.current).toBeFalsy();
  });
});

describe('AC5 (issue 77) — account "sign-in-current"', () => {
  it('AC5: it is the same secondary "Sign in" link, to /supper-club/sign-in, marked as the page showing', async () => {
    const { buttons } = await header("sign-in-current");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props).toMatchObject({ kind: "secondary", href: SIGN_IN_PATH, current: true });
  });
});

// Issue 159: read in the bar, the account links, then Sign out.
describe("AC4 (issue 97) — signed in as a member", () => {
  beforeEach(() => {
    session.member = { role: "member" };
  });

  it("AC4: after the wordmark the header shows the account links, then Sign out, and no Admin and no Sign in", async () => {
    const { buttons, forms } = await header("sign-in");
    expect(sequence(buttons)).toEqual([...LINKS, SIGN_OUT]);
    expect(forms.map((form) => form.props.action)).toEqual([signOut]);
  });

  it("AC4: Sign out is a menu submit button alone in a form whose action is signOut, in the bar and at the drawer's foot", async () => {
    const { forms, drawer } = await header("sign-in");
    for (const found of [forms, drawer.foot.forms]) {
      expect(found.map((form) => form.props.action)).toEqual([signOut]);
      const buttons = findAll(found[0], Button);
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.props).toMatchObject({ kind: "menu", type: "submit" });
    }
  });

  it.each(["none", "sign-in", "sign-in-current"] as const)(
    'AC6 (issue 97): with account "%s" the header shows Sign out and no Sign in: account is only the signed-out state',
    async (account) => {
      const { buttons, forms } = await header(account);
      expect(sequence(buttons)).toEqual([...LINKS, SIGN_OUT]);
      expect(forms.map((form) => form.props.action)).toEqual([signOut]);
    },
  );
});

describe("AC5 (issue 97) — signed in as an admin", () => {
  beforeEach(() => {
    session.member = { role: "admin" };
  });

  it("AC5: after the account links the header shows the Admin group's links, then Sign out", async () => {
    const { buttons, forms, groups } = await header("sign-in");
    expect(sequence(buttons)).toEqual([...LINKS, ...ADMIN_LINKS, SIGN_OUT]);
    expect(groups).toHaveLength(1);
    expect(forms.map((form) => form.props.action)).toEqual([signOut]);
  });

  it("AC5: the Admin group holds menu links to Members, Menus, Weeks and Weekly lists, and is not active when `current` is not given", async () => {
    const { buttons, groups } = await header("none");
    expect(groups).toHaveLength(1);
    const admin = inGroup(groups[0]);
    expect(admin.map((button) => [button.props.kind, button.props.href])).toEqual(ADMIN_LINKS.map((href) => ["menu", href]));
    expect(admin.filter((button) => button.props.current)).toEqual([]);
    expect(groups[0]?.props.active).toBe(false);
    expect(sequence(buttons.filter((button) => !admin.includes(button)))).toEqual([...LINKS, SIGN_OUT]);
  });

  it('AC5: with current "admin-members", the Admin group is active and Members is marked as the page showing', async () => {
    const { buttons, groups } = await header("none", "admin-members");
    expect(groups.map((group) => group.props.active)).toEqual([true]);
    expect(linkTo(buttons, ADMIN_PATH)?.props).toMatchObject({ href: ADMIN_PATH, current: true });
  });

  it('AC6 (issue 97): with account "sign-in-current" the header still shows the Admin group, then Sign out', async () => {
    const { buttons, forms, groups } = await header("sign-in-current");
    expect(sequence(buttons)).toEqual([...LINKS, ...ADMIN_LINKS, SIGN_OUT]);
    expect(groups).toHaveLength(1);
    expect(forms.map((form) => form.props.action)).toEqual([signOut]);
  });
});

// Issue 136, AC5: a Your account button. Issue 155 replaces it with the Your meal link, the first of the account
// links, and issue 219 names it Your account again; these read it in the bar. Signed out it is not shown: the signed-out word lists above (AC18, AC17, AC5 of
// issue 77) hold every word the header has.
describe("AC5 (issue 136) — the Your account link", () => {
  it('AC5: signed in as a member, the header shows a menu "Your account" link to ACCOUNT_PATH, then Sign out', async () => {
    session.member = { role: "member" };
    const { buttons } = await header("none");
    expect(sequence(buttons)).toEqual([...LINKS, SIGN_OUT]);
    expect(linkTo(buttons, ACCOUNT_PATH)?.props).toMatchObject({ kind: "menu", href: ACCOUNT_PATH });
    expect(linkTo(buttons, ACCOUNT_PATH)?.props.current).toBeFalsy();
  });

  it("AC5: signed in as an admin, the buttons are Your account, Upcoming weeks, History, Members, Menus, Weeks, Weekly lists, Sign out, in that order", async () => {
    session.member = { role: "admin" };
    const { buttons } = await header("none");
    expect(sequence(buttons)).toEqual([ACCOUNT_PATH, WEEKS_PATH, HISTORY_PATH, ADMIN_PATH, ADMIN_MENUS_PATH, ADMIN_WEEKS_PATH, ADMIN_LISTS_PATH, SIGN_OUT]);
  });

  it.each(["member", "admin"] as const)('AC5: signed in as %s, with current "account", Your account is marked as the page showing', async (role) => {
    session.member = { role };
    expect(linkTo((await header("none", "account")).buttons, ACCOUNT_PATH)?.props).toMatchObject({ href: ACCOUNT_PATH, current: true });
  });

  it('AC5: with current "account", no admin link is marked and the Admin group is not active; with current "admin-members", Your account is not marked', async () => {
    session.member = { role: "admin" };
    const onAccount = await header("none", "account");
    expect(onAccount.groups).toHaveLength(1);
    expect(inGroup(onAccount.groups[0]).filter((button) => button.props.current)).toEqual([]);
    expect(onAccount.groups[0]?.props.active).toBe(false);
    const onAdmin = (await header("none", "admin-members")).buttons;
    expect(linkTo(onAdmin, ACCOUNT_PATH)).toBeDefined();
    expect(linkTo(onAdmin, ACCOUNT_PATH)?.props.current).toBeFalsy();
  });
});

describe("AC9 (issue 155) — the account nav", () => {
  it("AC9: signed in, the bar's account links are menu links: Your account to /account, Upcoming weeks to /account/weeks, History to /account/history", async () => {
    session.member = { role: "member" };
    const { buttons } = await header("none");
    expect(buttons.filter((button) => button.props.href !== undefined).map((button) => button.props)).toEqual([
      expect.objectContaining({ kind: "menu", href: ACCOUNT_PATH }),
      expect.objectContaining({ kind: "menu", href: WEEKS_PATH }),
      expect.objectContaining({ kind: "menu", href: HISTORY_PATH }),
    ]);
  });

  it.each([
    ["member", [...LINKS]],
    ["admin", [...ADMIN_LINKS, ...LINKS]],
  ] as const)("AC9: signed in as %s, the header has one drawer holding the same links, an admin's admin links first, then Sign out at its foot", async (role, expected) => {
    session.member = { role };
    const { drawers, drawer } = await header("none");
    expect(drawers).toHaveLength(1);
    expect(sequence(drawer.links.buttons)).toEqual(expected);
    expect(sequence(drawer.foot.buttons)).toEqual([SIGN_OUT]);
    expect(drawer.foot.forms.map((form) => form.props.action)).toEqual([signOut]);
  });

  it("AC9: the drawer's links are the bar's: the same kind and destination, order aside", async () => {
    session.member = { role: "admin" };
    const { buttons, drawer } = await header("none");
    const links = (found: Buttons) =>
      found
        .filter((button) => button.props.href !== undefined)
        .map(({ props }) => [props.kind, props.href])
        .sort(([, a], [, b]) => String(a).localeCompare(String(b)));
    expect(links(drawer.buttons)).toEqual(links(buttons));
    expect(links(drawer.buttons)).toHaveLength(7);
  });

  it.each([
    ["account", ACCOUNT_PATH],
    ["weeks", WEEKS_PATH],
    ["history", HISTORY_PATH],
    ["admin-members", ADMIN_PATH],
  ] as const)('AC9: with current "%s", that link alone is marked as the page showing, in the bar and in the drawer', async (current, href) => {
    session.member = { role: "admin" };
    const { buttons, drawer } = await header("none", current);
    for (const found of [buttons, drawer.buttons]) {
      expect(found.filter((button) => button.props.current).map((button) => button.props.href)).toEqual([href]);
    }
  });
});

// Issue 219, AC8: Your details went into Your account, so the menu has three member links; the account, card and cancel
// pages pass current "account" (their own tests).
describe("AC8 (issue 219) — three member links", () => {
  it.each(["member", "admin"] as const)("AC8: signed in as %s, the member links are /account, /account/weeks and /account/history, in that order, in the bar and in the drawer", async (role) => {
    session.member = { role };
    const { buttons, drawer } = await header("none");
    const memberLinks = (found: Buttons) => found.map((button) => button.props.href).filter((href) => typeof href === "string" && !String(href).startsWith("/admin"));
    for (const found of [buttons, drawer.buttons]) expect(memberLinks(found)).toEqual(LINKS);
  });
});

// Issue 84: a quiet button's text ends 8px inside its tap area, so the one that ended the header's row was
// pulled flush with the gutter. A secondary button has its own border and is not. Issue 159: signed in, Sign out is a
// menu entry, so the signed-in cases went; these hold the signed-out header (issue 159, AC6).
describe("issue 84 — the quiet button that ends the header is flush with the gutter", () => {
  it('account "none": the wordmark ends the row, so there is no button to be flush', async () => {
    expect((await header("none")).buttons).toEqual([]);
  });

  it("a pane page: the one button is Sign in, secondary and not flush; below lg nothing follows the wordmark", async () => {
    const { buttons } = await header("sign-in", undefined, true);
    expect(buttons.map((button) => [button.props.href, button.props.kind, button.props.flush])).toEqual([[SIGN_IN_PATH, "secondary", undefined]]);
  });

  it.each(["sign-in", "sign-in-current"] as const)('account "%s": Sign in ends the row, secondary and not flush', async (account) => {
    const { buttons } = await header(account);
    expect(buttons.map((button) => [button.props.href, button.props.kind, button.props.flush])).toEqual([[SIGN_IN_PATH, "secondary", undefined]]);
  });
});

describe("AC3 (issue 187) — the header has no language switch", () => {
  const states: Array<[string, null | "member" | "admin", Account, boolean]> = [
    ['signed out, account "none"', null, "none", false],
    ['signed out, account "sign-in"', null, "sign-in", false],
    ['signed out, account "sign-in-current"', null, "sign-in-current", false],
    ["signed out, a pane page", null, "sign-in", true],
    ["signed in as a member", "member", "sign-in", false],
    ["signed in as an admin", "admin", "none", false],
  ];

  // Signed in, Sign out is drawn twice (issue 159): in the bar and at the drawer's foot; both are read.
  it.each(states)("AC3: %s, no language is named and no form but Sign out's is in the header", async (_state, role, account, wideOnly) => {
    session.member = role === null ? null : { role };
    const { words, forms, drawer } = await header(account, undefined, wideOnly);
    expect([...words, ...drawer.words].filter((word) => LANGUAGE_NAMES.includes(word))).toEqual([]);
    expect([...forms, ...drawer.forms].map((form) => form.props.action)).toEqual(role === null ? [] : [signOut, signOut]);
  });
});

// ---------------------------------------------------------------------------------------------
// Issue 159: the signed-in header, one bar with a drawer below 1024px.

describe("AC1 (issue 159) — a member's header", () => {
  beforeEach(() => {
    session.member = { role: "member" };
  });

  it.each([undefined, "account", "weeks", "history"] as const)(
    "AC1: with current %s, the bar holds Your account, Upcoming weeks, History in that order, then the Sign out form, and no Admin group",
    async (current) => {
      const { buttons, forms, groups } = await header("none", current);
      expect(sequence(buttons)).toEqual([...LINKS, SIGN_OUT]);
      expect(groups).toEqual([]);
      expect(forms.map((form) => form.props.action)).toEqual([signOut]);
    },
  );
});

describe("AC2 (issue 159) — an admin's header", () => {
  beforeEach(() => {
    session.member = { role: "admin" };
  });

  it.each([undefined, "account", "admin-members", "admin-lists"] as const)(
    "AC2: with current %s, the bar holds the account links, then one Admin group of Members, Menus, Weeks, Weekly lists in that order, then the Sign out form",
    async (current) => {
      const { buttons, forms, groups } = await header("none", current);
      expect(sequence(buttons)).toEqual([...LINKS, ...ADMIN_LINKS, SIGN_OUT]);
      expect(groups).toHaveLength(1);
      expect(sequence(inGroup(groups[0]))).toEqual(ADMIN_LINKS);
      expect(forms.map((form) => form.props.action)).toEqual([signOut]);
    },
  );
});

describe("AC3 (issue 159) — the page showing is marked", () => {
  beforeEach(() => {
    session.member = { role: "admin" };
  });

  // Each member page, and Members, is AC9 (issue 155) above.
  it.each([
    ["admin-menus", ADMIN_MENUS_PATH],
    ["admin-weeks", ADMIN_WEEKS_PATH],
    ["admin-lists", ADMIN_LISTS_PATH],
  ] as const)('AC3: with current "%s", the link to %s alone is marked as the page showing, in the bar and in the drawer', async (current, href) => {
    const { buttons, drawer } = await header("none", current);
    for (const found of [buttons, drawer.buttons]) {
      expect(found.filter((button) => button.props.current).map((button) => button.props.href)).toEqual([href]);
    }
  });

  it.each([
    [undefined, false],
    ["account", false],
    ["weeks", false],
    ["history", false],
    ["admin-members", true],
    ["admin-menus", true],
    ["admin-weeks", true],
    ["admin-lists", true],
  ] as const)("AC3: with current %s, the Admin group's active is %s", async (current, active) => {
    const { groups } = await header("none", current);
    expect(groups.map((group) => group.props.active)).toEqual([active]);
  });
});

describe("AC4 (issue 159) — the drawer", () => {
  it.each([
    ["member", [...LINKS]],
    ["admin", ["heading", ...ADMIN_LINKS, ...LINKS]],
  ] as const)("AC4: signed in as %s, the drawer lists, for an admin, an Admin heading and the admin links first, openly, then the member links, with no form among them", async (role, expected) => {
    session.member = { role };
    const { drawers, drawer } = await header("none");
    expect(drawers).toHaveLength(1);
    expect(marks(drawer.links.node)).toEqual(expected);
    expect(findAll(drawer.links.node, "details")).toEqual([]);
    expect(drawer.links.forms).toEqual([]);
  });
});

describe("AC6 (issue 159) — the signed-out header is unchanged", () => {
  const states: Array<[string, null | "member" | "admin", Account, boolean]> = [
    ['signed out, account "none"', null, "none", false],
    ['signed out, account "sign-in"', null, "sign-in", false],
    ['signed out, account "sign-in-current"', null, "sign-in-current", false],
    ["signed out, a pane page", null, "sign-in", true],
    ["signed in as a member", "member", "none", false],
    ["signed in as an admin", "admin", "none", false],
  ];

  it.each(states)("AC6: %s, the header's frame is widened only when signed in", async (_state, role, account, wideOnly) => {
    session.member = role === null ? null : { role };
    const { element } = await header(account, undefined, wideOnly);
    expect(findAll(element, SiteBar).map((bar) => bar.props.wide === true)).toEqual([role !== null]);
  });

  it.each(states.filter(([, role]) => role === null))("AC6: %s, the header has no drawer and no Admin group", async (_state, _role, account, wideOnly) => {
    const { tree } = await header(account, undefined, wideOnly);
    expect(findAll(tree, MenuDrawer)).toEqual([]);
    expect(findAll(tree, MenuGroup)).toEqual([]);
  });
});
