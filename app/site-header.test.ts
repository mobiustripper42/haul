// Issue 55, AC17 and AC18: the header moved out of app/sign-in/layout.tsx. `await SiteHeader(props)` is read
// as the tree it returns, and as markup for the order of its words, with `next/headers` faked.
// Issue 77, AC4 and AC5: the link goes to the sign-in pane and can be marked current.
// Issue 97, AC3–AC6: the header reads the session itself. Signed out it is as each page sets it with
// `account`; signed in it shows Admin (admins only) and Sign out, whatever `account` says.
// Issue 155, AC9: signed in, the account links are drawn twice from one list: in the row, shown at 720px and wider,
// and in the Menu button's panel, shown below it. The row is read as the tree with the MenuButton taken out, the
// panel as the MenuButton's children; which one a width shows is measured in the browser (e2e/account-nav.spec.ts).
// Issue 187, AC3: the header has no language switch, signed in or out, on any page. The session is faked as a
// member or an admin; who counts as signed in is app/session.test.ts's. The wide-only wrapper for issue 77's
// AC11 ("below `lg`") is measured in the browser, e2e/supper-club.spec.ts.
import { cloneElement, createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LANGUAGES } from "@core/i18n.js";
import { Button } from "../components/ui/button";
import { MenuButton } from "../components/ui/menu-button";
import { SiteBar } from "../components/ui/site-bar";
import { emptyRequest } from "./next-headers-fake";
import { ACCOUNT_PATH, ADMIN_PATH } from "./paths";
import { findAll, textsOf } from "./screen-test-helpers";
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
// Issue 156, AC1: Your details after History.
const DETAILS_PATH = "/account/details";
/** The account links' destinations, in order: the row's and the panel's. */
const LINKS = [ACCOUNT_PATH, WEEKS_PATH, HISTORY_PATH, DETAILS_PATH];
/** Sign out, in a sequence of buttons: the one with no destination, a submit. */
const SIGN_OUT = "submit";
const LANGUAGE_NAMES: string[] = Object.values(LANGUAGES).map((language) => language.name);

type Account = "none" | "sign-in" | "sign-in-current";
type Current = "admin" | "account" | "weeks" | "history" | "details";

/** Components read as themselves; every other function component is called through, so what it draws is read too. */
const KEPT = new Set<unknown>([Button, SiteBar, MenuButton]);

const expand = (node: ReactNode): ReactNode => {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  if (typeof node.type === "function" && !KEPT.has(node.type)) return expand((node.type as (props: unknown) => ReactNode)(node.props));
  if (node.props.children === undefined) return node;
  const children = expand(node.props.children as ReactNode);
  return cloneElement(node, undefined, ...(Array.isArray(children) ? children : [children]));
};

/** The tree with every MenuButton taken out: the row. */
const withoutMenu = (node: ReactNode): ReactNode => {
  if (Array.isArray(node)) return node.map(withoutMenu);
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  if (node.type === MenuButton) return null;
  if (node.props.children === undefined) return node;
  const children = withoutMenu(node.props.children as ReactNode);
  return cloneElement(node, undefined, ...(Array.isArray(children) ? children : [children]));
};

const wordsOf = (node: ReactNode): string[] => textsOf(renderToStaticMarkup(createElement(Fragment, null, node)));

const header = async (account: Account, current?: Current, wideOnly?: boolean) => {
  const element = await SiteHeader({ account, ...(current === undefined ? {} : { current }), ...(wideOnly ? { wideOnly } : {}) });
  const tree = expand(element);
  const row = withoutMenu(tree);
  const menus = findAll(tree, MenuButton);
  const panel = menus[0]?.props.children as ReactNode;
  return {
    element,
    words: wordsOf(row),
    buttons: findAll(row, Button),
    forms: findAll(row, "form"),
    menus,
    panel: { words: wordsOf(panel), buttons: findAll(panel, Button), forms: findAll(panel, "form") },
  };
};

type Buttons = ReactElement<Record<string, unknown>>[];
const linkTo = (buttons: Buttons, href: string) => buttons.find((button) => button.props.href === href);
/** The buttons in order, each as its destination, or its type for one that submits. */
const sequence = (buttons: Buttons) => buttons.map((button) => button.props.href ?? button.props.type);

describe("AC18 — SiteHeader, account none, is the header the sign-in screens had", () => {
  it("AC18: the farm's name is the one link, and it goes to /", async () => {
    const { element } = await header("none");
    expect(findAll(element, "a").map((link) => link.props.href)).toEqual(["/"]);
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

// Issue 155: read in the row, the account links, then Sign out.
describe("AC4 (issue 97) — signed in as a member", () => {
  beforeEach(() => {
    session.member = { role: "member" };
  });

  it("AC4: after the wordmark the header shows the account links, then Sign out, and no Admin and no Sign in", async () => {
    const { buttons, forms } = await header("sign-in");
    expect(sequence(buttons)).toEqual([...LINKS, SIGN_OUT]);
    expect(forms.map((form) => form.props.action)).toEqual([signOut]);
  });

  it("AC4: Sign out is a quiet submit button alone in a form whose action is signOut", async () => {
    const { forms, panel } = await header("sign-in");
    for (const found of [forms, panel.forms]) {
      expect(found.map((form) => form.props.action)).toEqual([signOut]);
      const buttons = findAll(found[0], Button);
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.props).toMatchObject({ kind: "quiet", type: "submit" });
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

  it("AC5: after the account links the header shows Admin, then Sign out", async () => {
    const { buttons, forms } = await header("sign-in");
    expect(sequence(buttons)).toEqual([...LINKS, ADMIN_PATH, SIGN_OUT]);
    expect(forms.map((form) => form.props.action)).toEqual([signOut]);
  });

  it("AC5: Admin is a secondary link to ADMIN_PATH, not marked current when `current` is not given", async () => {
    const { buttons } = await header("none");
    const admin = linkTo(buttons, ADMIN_PATH);
    expect(admin?.props).toMatchObject({ kind: "secondary", href: ADMIN_PATH });
    expect(admin?.props.current).toBeFalsy();
    expect(sequence(buttons.filter((button) => button !== admin))).toEqual([...LINKS, SIGN_OUT]);
  });

  it('AC5: with current "admin", Admin is marked as the page showing', async () => {
    expect(linkTo((await header("none", "admin")).buttons, ADMIN_PATH)?.props).toMatchObject({ href: ADMIN_PATH, current: true });
  });

  it('AC6 (issue 97): with account "sign-in-current" the header still shows Admin, then Sign out', async () => {
    const { buttons, forms } = await header("sign-in-current");
    expect(sequence(buttons)).toEqual([...LINKS, ADMIN_PATH, SIGN_OUT]);
    expect(forms.map((form) => form.props.action)).toEqual([signOut]);
  });
});

// Issue 136, AC5: a Your account button. Issue 155 replaces it with the Your meal link, the first of the account
// links; these read it in the row. Signed out it is not shown: the signed-out word lists above (AC18, AC17, AC5 of
// issue 77) hold every word the header has.
describe("AC5 (issue 136) — the Your meal link", () => {
  it('AC5: signed in as a member, the header shows a secondary "Your meal" link to ACCOUNT_PATH, then Sign out', async () => {
    session.member = { role: "member" };
    const { buttons } = await header("none");
    expect(sequence(buttons)).toEqual([...LINKS, SIGN_OUT]);
    expect(linkTo(buttons, ACCOUNT_PATH)?.props).toMatchObject({ kind: "secondary", href: ACCOUNT_PATH });
    expect(linkTo(buttons, ACCOUNT_PATH)?.props.current).toBeFalsy();
  });

  it("AC5: signed in as an admin, the buttons are Your meal, Upcoming weeks, History, Admin, Sign out, in that order", async () => {
    session.member = { role: "admin" };
    const { buttons } = await header("none");
    expect(sequence(buttons)).toEqual([ACCOUNT_PATH, WEEKS_PATH, HISTORY_PATH, DETAILS_PATH, ADMIN_PATH, SIGN_OUT]);
  });

  it.each(["member", "admin"] as const)('AC5: signed in as %s, with current "account", Your meal is marked as the page showing', async (role) => {
    session.member = { role };
    expect(linkTo((await header("none", "account")).buttons, ACCOUNT_PATH)?.props).toMatchObject({ href: ACCOUNT_PATH, current: true });
  });

  it('AC5: with current "account", Admin is not marked as the page showing; with current "admin", Your meal is not', async () => {
    session.member = { role: "admin" };
    expect(linkTo((await header("none", "account")).buttons, ADMIN_PATH)?.props.current).toBeFalsy();
    const onAdmin = (await header("none", "admin")).buttons;
    expect(linkTo(onAdmin, ACCOUNT_PATH)).toBeDefined();
    expect(linkTo(onAdmin, ACCOUNT_PATH)?.props.current).toBeFalsy();
  });
});

describe("AC9 (issue 155) — the account nav", () => {
  it("AC9: signed in, the row's account links are secondary links: Your meal to /account, Upcoming weeks to /account/weeks, History to /account/history", async () => {
    session.member = { role: "member" };
    const { buttons } = await header("none");
    expect(buttons.filter((button) => button.props.href !== undefined).map((button) => button.props)).toEqual([
      expect.objectContaining({ kind: "secondary", href: ACCOUNT_PATH }),
      expect.objectContaining({ kind: "secondary", href: WEEKS_PATH }),
      expect.objectContaining({ kind: "secondary", href: HISTORY_PATH }),
      expect.objectContaining({ kind: "secondary", href: DETAILS_PATH }),
    ]);
  });

  it.each([
    ["member", [...LINKS, SIGN_OUT]],
    ["admin", [...LINKS, ADMIN_PATH, SIGN_OUT]],
  ] as const)("AC9: signed in as %s, the row folds into one Menu button whose panel holds the same links, then Sign out", async (role, expected) => {
    session.member = { role };
    const { menus, panel } = await header("none");
    expect(menus).toHaveLength(1);
    expect(sequence(panel.buttons)).toEqual(expected);
    expect(panel.forms.map((form) => form.props.action)).toEqual([signOut]);
  });

  it("AC9: the panel's links are the row's: the same kind and destination", async () => {
    session.member = { role: "admin" };
    const { buttons, panel } = await header("none");
    const links = (found: Buttons) => found.filter((button) => button.props.href !== undefined).map(({ props }) => [props.kind, props.href]);
    expect(links(panel.buttons)).toEqual(links(buttons));
    expect(links(panel.buttons)).toHaveLength(5);
  });

  it.each([
    ["account", ACCOUNT_PATH],
    ["weeks", WEEKS_PATH],
    ["history", HISTORY_PATH],
    ["admin", ADMIN_PATH],
  ] as const)('AC9: with current "%s", that link alone is marked as the page showing, in the row and in the panel', async (current, href) => {
    session.member = { role: "admin" };
    const { buttons, panel } = await header("none", current);
    for (const found of [buttons, panel.buttons]) {
      expect(found.filter((button) => button.props.current).map((button) => button.props.href)).toEqual([href]);
    }
  });
});

// Issue 156, AC1: Your details joins the account nav after History; the page passes current "details" (its own test).
describe("AC1 (issue 156) — the Your details link", () => {
  it.each(["member", "admin"] as const)('AC1: signed in as %s, "Your details" is a secondary link to /account/details straight after History, in the row and in the panel', async (role) => {
    session.member = { role };
    const { buttons, panel } = await header("none");
    for (const found of [buttons, panel.buttons]) {
      const hrefs = found.filter((button) => button.props.href !== undefined).map((button) => button.props.href);
      expect(hrefs[hrefs.indexOf(HISTORY_PATH) + 1]).toBe(DETAILS_PATH);
      expect(linkTo(found, DETAILS_PATH)?.props).toMatchObject({ kind: "secondary", href: DETAILS_PATH });
    }
  });

  it('AC1: with current "details", Your details alone is marked as the page showing, in the row and in the panel', async () => {
    session.member = { role: "member" };
    const { buttons, panel } = await header("none", "details");
    for (const found of [buttons, panel.buttons]) {
      expect(found.filter((button) => button.props.current).map((button) => button.props.href)).toEqual([DETAILS_PATH]);
    }
  });
});

// Issue 84: a quiet button's text ends 8px inside its tap area, so the one that ends the header's row is
// pulled flush with the gutter. A secondary button has its own border and is not.
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

  // Issue 155: read in the row; in the Menu's panel nothing is flush.
  it.each(["member", "admin"] as const)("signed in as %s: Sign out ends the row and is flush; no other button is", async (role) => {
    session.member = { role };
    const { buttons, panel } = await header("none", undefined, true);
    const signOutButton = buttons.find((button) => button.props.type === "submit");
    expect(signOutButton?.props.flush).toBe("end");
    expect(buttons.filter((button) => button !== signOutButton).map((button) => button.props.flush)).toEqual(
      buttons.filter((button) => button !== signOutButton).map(() => undefined),
    );
    expect(panel.buttons.length).toBeGreaterThan(0);
    expect(panel.buttons.map((button) => button.props.flush)).toEqual(panel.buttons.map(() => undefined));
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

  // Signed in, Sign out is drawn twice (issue 155): in the row and in the Menu's panel; both are read.
  it.each(states)("AC3: %s, no language is named and no form but Sign out's is in the header", async (_state, role, account, wideOnly) => {
    session.member = role === null ? null : { role };
    const { words, forms, panel } = await header(account, undefined, wideOnly);
    expect([...words, ...panel.words].filter((word) => LANGUAGE_NAMES.includes(word))).toEqual([]);
    expect([...forms, ...panel.forms].map((form) => form.props.action)).toEqual(role === null ? [] : [signOut, signOut]);
  });
});
