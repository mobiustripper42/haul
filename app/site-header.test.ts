// Issue 55, AC17 and AC18: the header moved out of app/sign-in/layout.tsx. `await SiteHeader(props)` is read
// as the tree it returns, and as markup for the order of its words, with `next/headers` faked.
// Issue 77, AC4 and AC5: the link goes to the sign-in pane and can be marked current.
// Issue 97, AC3–AC6: the header reads the session itself. Signed out it is as each page sets it with
// `account`; signed in it shows the account links and Sign out (and, for admins, issue 266's switch), whatever `account` says.
// Issue 159 (which replaces issue 155's row and Menu): signed in, the links are drawn twice from one list: in the bar,
// shown at 1024px and wider, and in the MenuDrawer, shown below it. "The bar" is the tree with the MenuDrawer taken out;
// "the drawer" is the MenuDrawer's `children` and its `foot`, which the header builds. Which one a width shows is measured
// in the browser (e2e/account-nav.spec.ts); `aria-current` is Button's (components/ui/button.test.ts), so here it is what
// the header hands it. Issue 266: an admin sees one interface at a time, the Admin interface on a page whose `current`
// starts `admin-` and the Member interface on every other, each with a switch to the other; its tests are at the end.
// Issue 187, AC3: the header has no language switch, signed in or out, on any page. The session is faked as a
// member or an admin; who counts as signed in is app/session.test.ts's. The wide-only wrapper for issue 77's
// AC11 ("below `lg`") is measured in the browser, e2e/supper-club.spec.ts.
// Issue 260: a signed-in member is one with an active, paid subscription unless a test names another; the links of one with
// none are the AC1 to AC3 (issue 260) tests at the end. Which subscription is active is findActiveSubscription's
// (src/adapters/signup-contract.ts).
import { Children, cloneElement, createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { LANGUAGES } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { Button } from "../components/ui/button";
import { Eyebrow } from "../components/ui/eyebrow";
import { LinkLabel } from "../components/ui/link-label";
import { MenuDrawer } from "../components/ui/menu-drawer";
import { MenuGroup } from "../components/ui/menu-group";
import { MenuScript } from "../components/ui/menu-script";
import { SiteBar } from "../components/ui/site-bar";
import { Wordmark } from "../components/ui/wordmark";
import { addSupperClub } from "./admin/subscribers-fixture";
import { emptyRequest } from "./next-headers-fake";
import { ACCOUNT_PATH, ADMIN_LISTS_PATH, ADMIN_MENUS_PATH, ADMIN_PATH, ADMIN_WEEKS_PATH } from "./paths";
import { attributesOf, findAll, textsOf } from "./screen-test-helpers";
import { SiteHeader } from "./site-header";
import { signOut } from "./sign-in/actions";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
const session = vi.hoisted(() => ({
  /** Who is signed in: the `subscriber`, with what is given here changed. */
  member: null as null | Partial<import("@core/members.js").Member>,
  /** A member with an active, paid subscription. */
  subscriber: undefined as unknown as import("@core/members.js").Member,
}));
const services = vi.hoisted(() => ({ repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("./screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("./services", () => ({ getRepository: () => services.repo, getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789" }));
vi.mock("./session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  getSignedInMember: async () => session.member && { ...session.subscriber, ...session.member },
}));

let product: ProductWithOptions;

beforeEach(async () => {
  request.current = emptyRequest();
  session.member = null;
  services.repo = new InMemoryRepository();
  product = addSupperClub(services.repo);
  session.subscriber = await services.repo.createMember({ email: "ada@example.com" });
  await paidSignup(session.subscriber);
});

/** The member's signup, paid: an active subscription. */
const paidSignup = async (member: Member): Promise<PendingSignup> => {
  const rows = await services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 8000,
    weeklyCents: 8000,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $80.",
    consentAt: new Date("2026-12-01T17:00:00.000Z"),
  });
  await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
  return rows;
};

const SIGN_IN_PATH = "/supper-club/sign-in";
const WEEKS_PATH = "/account/weeks";
/** Issue 243: History is a part of the Upcoming weeks page. */
const HISTORY_PATH = "/account/weeks#history";
/** The account links' destinations, in order: the bar's and the drawer's. Issue 219: Your details went into Your account. */
const LINKS = [ACCOUNT_PATH, WEEKS_PATH, HISTORY_PATH];
/** Issue 159, AC2: the admin links' destinations, in order: Members, Menus, Weeks, Weekly lists. */
const ADMIN_LINKS = [ADMIN_PATH, ADMIN_MENUS_PATH, ADMIN_WEEKS_PATH, ADMIN_LISTS_PATH];
/** Sign out, in a sequence of buttons: the one with no destination, a submit. */
const SIGN_OUT = "submit";
const LANGUAGE_NAMES: string[] = Object.values(LANGUAGES).map((language) => language.name);

type Account = "none" | "sign-in" | "sign-in-current";
type Current = "supper-club" | "menu" | "account" | "weeks" | "admin-members" | "admin-menus" | "admin-weeks" | "admin-lists";

/**
 * Components read as themselves; every other function component is called through, so what it draws is read too.
 * MenuScript and LinkLabel, which the Wordmark's link holds (issue 240), are client components, kept so they are never called outside React.
 */
const KEPT = new Set<unknown>([Button, SiteBar, MenuDrawer, MenuGroup, MenuScript, LinkLabel, Eyebrow]);

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

  it("AC5: after the account links the header shows the switch to the admin's page, then Sign out, and no group", async () => {
    const { buttons, forms, groups } = await header("sign-in");
    expect(sequence(buttons)).toEqual([...LINKS, ADMIN_PATH, SIGN_OUT]);
    expect(groups).toEqual([]);
    expect(forms.map((form) => form.props.action)).toEqual([signOut]);
  });

  it("AC5: on an admin page the bar holds menu links to Members, Menus, Weeks and Weekly lists, outside any group", async () => {
    const { buttons, groups } = await header("none", "admin-menus");
    expect(groups).toEqual([]);
    expect(buttons.slice(0, ADMIN_LINKS.length).map((button) => [button.props.kind, button.props.href])).toEqual(ADMIN_LINKS.map((href) => ["menu", href]));
  });

  it('AC5: with current "admin-members", Members is marked as the page showing, and no group is drawn', async () => {
    const { buttons, groups } = await header("none", "admin-members");
    expect(groups).toEqual([]);
    expect(linkTo(buttons, ADMIN_PATH)?.props).toMatchObject({ kind: "menu", href: ADMIN_PATH, current: true });
  });

  it('AC6 (issue 97): with account "sign-in-current" the header still shows the account links, the switch, then Sign out', async () => {
    const { buttons, forms, groups } = await header("sign-in-current");
    expect(sequence(buttons)).toEqual([...LINKS, ADMIN_PATH, SIGN_OUT]);
    expect(groups).toEqual([]);
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

  it("AC5: signed in as an admin, the buttons are Your account, Upcoming weeks, History, the switch to the admin's page, Sign out, in that order", async () => {
    session.member = { role: "admin" };
    const { buttons } = await header("none");
    expect(sequence(buttons)).toEqual([ACCOUNT_PATH, WEEKS_PATH, HISTORY_PATH, ADMIN_PATH, SIGN_OUT]);
  });

  it.each(["member", "admin"] as const)('AC5: signed in as %s, with current "account", Your account is marked as the page showing', async (role) => {
    session.member = { role };
    expect(linkTo((await header("none", "account")).buttons, ACCOUNT_PATH)?.props).toMatchObject({ href: ACCOUNT_PATH, current: true });
  });

  it('AC5: with current "account", the switch to the admin\'s page is not marked; with current "admin-members", the switch to Your account is not marked', async () => {
    session.member = { role: "admin" };
    const onAccount = (await header("none", "account")).buttons;
    expect(linkTo(onAccount, ADMIN_PATH)).toBeDefined();
    expect(linkTo(onAccount, ADMIN_PATH)?.props.current).toBeFalsy();
    const onAdmin = (await header("none", "admin-members")).buttons;
    expect(linkTo(onAdmin, ACCOUNT_PATH)).toBeDefined();
    expect(linkTo(onAdmin, ACCOUNT_PATH)?.props.current).toBeFalsy();
  });
});

describe("AC9 (issue 155) — the account nav", () => {
  it("AC9: signed in, the bar's account links are menu links: Your account to /account, Upcoming weeks to /account/weeks, History to /account/weeks#history", async () => {
    session.member = { role: "member" };
    const { buttons } = await header("none");
    expect(buttons.filter((button) => button.props.href !== undefined).map((button) => button.props)).toEqual([
      expect.objectContaining({ kind: "menu", href: ACCOUNT_PATH }),
      expect.objectContaining({ kind: "menu", href: WEEKS_PATH }),
      expect.objectContaining({ kind: "menu", href: HISTORY_PATH }),
    ]);
  });

  it.each([
    ["member", [SIGN_OUT]],
    ["admin", [ADMIN_PATH, SIGN_OUT]],
  ] as const)("AC9: signed in as %s, the header has one drawer holding the same links, then at its foot, for an admin, the switch, then Sign out", async (role, foot) => {
    session.member = { role };
    const { drawers, drawer } = await header("none");
    expect(drawers).toHaveLength(1);
    expect(sequence(drawer.links.buttons)).toEqual(LINKS);
    expect(sequence(drawer.foot.buttons)).toEqual(foot);
    expect(drawer.foot.forms.map((form) => form.props.action)).toEqual([signOut]);
  });

  it.each([undefined, "admin-members"] as const)("AC9: signed in as an admin, with current %s, the drawer's links are the bar's: the same kind and destination, order aside", async (current) => {
    session.member = { role: "admin" };
    const { buttons, drawer } = await header("none", current);
    const links = (found: Buttons) =>
      found
        .filter((button) => button.props.href !== undefined)
        .map(({ props }) => [props.kind, props.href])
        .sort(([, a], [, b]) => String(a).localeCompare(String(b)));
    expect(links(drawer.buttons)).toEqual(links(buttons));
  });

  it.each([
    ["account", ACCOUNT_PATH],
    ["weeks", WEEKS_PATH],
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
  it.each(["member", "admin"] as const)("AC8: signed in as %s, the member links are /account, /account/weeks and /account/weeks#history, in that order, in the bar and in the drawer", async (role) => {
    session.member = { role };
    const { buttons, drawer } = await header("none");
    const memberLinks = (found: Buttons) => found.map((button) => button.props.href).filter((href) => typeof href === "string" && !String(href).startsWith("/admin"));
    for (const found of [buttons, drawer.buttons]) expect(memberLinks(found)).toEqual(LINKS);
  });
});

// Issue 243: History is the second list of the Upcoming weeks page, and the server never sees the part of a link after
// `#`. The three links and their order are AC8 (issue 219) above.
describe("AC4 (issue 243) — the History link", () => {
  it.each([undefined, "account", "weeks"] as const)("AC4 (issue 243): with current %s, History's one link goes to /account/weeks#history and is not marked as the page showing, in the bar and in the drawer", async (current) => {
    session.member = { role: "member" };
    const { buttons, drawer } = await header("none", current);
    for (const found of [buttons, drawer.buttons]) {
      expect(found.filter((button) => String(button.props.href).includes("history")).map((button) => [button.props.href, Boolean(button.props.current)])).toEqual([["/account/weeks#history", false]]);
    }
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

  it.each([undefined, "account", "weeks"] as const)(
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

  it.each([
    [undefined, [...LINKS, ADMIN_PATH]],
    ["account", [...LINKS, ADMIN_PATH]],
    ["admin-members", [...ADMIN_LINKS, ACCOUNT_PATH]],
    ["admin-lists", [...ADMIN_LINKS, ACCOUNT_PATH]],
  ] as const)(
    "AC2: with current %s, the bar holds the page's interface's links, then the switch to the other, then the Sign out form, and no group",
    async (current, expected) => {
      const { buttons, forms, groups } = await header("none", current);
      expect(sequence(buttons)).toEqual([...expected, SIGN_OUT]);
      expect(groups).toEqual([]);
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
});

describe("AC4 (issue 159) — the drawer", () => {
  it.each(["member", "admin"] as const)("AC4: signed in as %s, the drawer lists the member links openly, with no heading and no form among them", async (role) => {
    session.member = { role };
    const { drawers, drawer } = await header("none");
    expect(drawers).toHaveLength(1);
    expect(sequence(drawer.links.buttons)).toEqual(LINKS);
    expect(findAll(drawer.links.node, Eyebrow)).toEqual([]);
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

// ---------------------------------------------------------------------------------------------
// Issue 260: a signed-in member with no active subscription, never joined or cancelled, an admin or not, gets Supper Club and
// This week's menu before the member links. The links are read by where they go, never their words.
describe("issue 260 — the header links of a member with no active subscription", () => {
  const SUPPER_CLUB = "/supper-club";
  const MENU = "/menu";
  const FIVE = [SUPPER_CLUB, MENU, ...LINKS];

  /** Grace, with no subscription. */
  const neverJoined = (): Promise<Member> => services.repo.createMember({ email: "grace@example.com" });
  /** Grace, whose one subscription is cancelled. */
  const cancelled = async (): Promise<Member> => {
    const member = await neverJoined();
    const { subscriptionId } = await paidSignup(member);
    await services.repo.cancelSubscription(subscriptionId, new Date("2027-02-03T17:00:00.000Z"));
    return member;
  };
  const marked = (found: Buttons) => found.filter((button) => button.props.current).map((button) => button.props.href);
  const newLinks = (found: Buttons) => found.map((button) => button.props.href).filter((href) => href === SUPPER_CLUB || href === MENU);

  it.each([
    ["a member who never joined", "member", neverJoined],
    ["a cancelled member", "member", cancelled],
    ["an admin who never joined", "admin", neverJoined],
  ] as const)("AC1: %s: the bar's member links are /supper-club, /menu, /account, /account/weeks and /account/weeks#history, in that order, each a menu link, then, for an admin, the switch to the admin's page, then Sign out", async (_who, role, who) => {
    session.member = { ...(await who()), role };
    const { buttons, groups } = await header("none");
    expect(sequence(buttons)).toEqual([...FIVE, ...(role === "admin" ? [ADMIN_PATH] : []), SIGN_OUT]);
    expect(buttons.slice(0, FIVE.length).map((button) => button.props.kind)).toEqual(FIVE.map(() => "menu"));
    expect(groups).toEqual([]);
  });

  it.each([
    ["a member who never joined", "member", neverJoined],
    ["a cancelled member", "member", cancelled],
    ["an admin who never joined", "admin", neverJoined],
  ] as const)("AC1: %s: the drawer holds the same five links in the same order, as full menu rows, and no heading", async (_who, role, who) => {
    session.member = { ...(await who()), role };
    const { drawer } = await header("none");
    expect(sequence(drawer.links.buttons)).toEqual(FIVE);
    expect(findAll(drawer.links.node, Eyebrow)).toEqual([]);
    expect(drawer.links.buttons.map((button) => [button.props.kind, button.props.full])).toEqual(drawer.links.buttons.map(() => ["menu", true]));
  });

  it.each(["member", "admin"] as const)("AC2: signed in as %s, with an active subscription, the header has neither new link, in the bar or the drawer", async (role) => {
    session.member = { role };
    const { buttons, drawer } = await header("none");
    expect(newLinks(buttons)).toEqual([]);
    expect(newLinks(drawer.buttons)).toEqual([]);
  });

  it.each([undefined, "supper-club", "menu"] as const)("AC2: signed out, with current %s, the header is the Sign in button alone, not marked as the page showing", async (current) => {
    const { buttons, drawers } = await header("sign-in", current);
    expect(sequence(buttons)).toEqual([SIGN_IN_PATH]);
    expect(marked(buttons)).toEqual([]);
    expect(drawers).toEqual([]);
  });

  it.each([
    ["supper-club", SUPPER_CLUB],
    ["menu", MENU],
  ] as const)('AC3: with current "%s", that link alone is marked as the page showing, in the bar and in the drawer', async (current, href) => {
    session.member = { ...(await neverJoined()), role: "admin" };
    const { buttons, drawer } = await header("sign-in", current);
    for (const found of [buttons, drawer.buttons]) expect(marked(found)).toEqual([href]);
  });

  it("AC3: with no current page, a pane's page, no link is marked", async () => {
    session.member = { ...(await neverJoined()), role: "member" };
    const { buttons, drawer } = await header("sign-in");
    for (const found of [buttons, drawer.buttons]) expect(marked(found)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Issue 266: an admin sees one interface at a time. The page's `current` decides: one starting `admin-` shows an admin the
// Admin interface (the four admin links, then a switch to Your account); any other, or none, the Member interface (the
// member links as issue 260 left them, then a switch to the admin's page). The switch is read by where it goes, never its
// words (the `Proof` slot); in the bar it is the link just before Sign out, in the drawer the link at its foot.
describe("issue 266 — an admin's two interfaces", () => {
  const SUPPER_CLUB = "/supper-club";
  const MENU = "/menu";
  const FIVE = [SUPPER_CLUB, MENU, ...LINKS];
  const ADMIN_MARKS = ["admin-members", "admin-menus", "admin-weeks", "admin-lists"] as const;
  const MEMBER_MARKS = [undefined, "supper-club", "menu", "account", "weeks"] as const;
  /** The member pages' links an admin page's bar must not hold. */
  const MEMBER_PAGES = [WEEKS_PATH, HISTORY_PATH, SUPPER_CLUB, MENU];

  /** An admin with no subscription: the widest Member interface. */
  const adminWithoutSubscription = async () => {
    session.member = { ...(await services.repo.createMember({ email: "lenny@example.com" })), role: "admin" };
  };
  const admin = () => {
    session.member = { role: "admin" };
  };
  const marked = (found: Buttons) => found.filter((button) => button.props.current).map((button) => button.props.href);
  /** The bar's switch: the button just before Sign out. */
  const barSwitch = (buttons: Buttons) => buttons[buttons.length - 2];
  /** The rows of the drawer's nav: every child it holds, null and false aside. */
  const navRows = (node: ReactNode) => {
    const navs = findAll(node, "nav");
    expect(navs).toHaveLength(1);
    return Children.toArray(navs[0]?.props.children as ReactNode) as ReactElement<Record<string, unknown>>[];
  };
  /** Where the farm's name goes: the one link the Wordmark the header draws renders. */
  const wordmarkHref = (element: ReactNode) => {
    const wordmarks = findAll(element, Wordmark);
    expect(wordmarks).toHaveLength(1);
    return attributesOf(renderToStaticMarkup(wordmarks[0] as ReactElement), "a").map((link) => link.href);
  };

  describe("AC1 — the Admin interface's bar", () => {
    it.each(ADMIN_MARKS)("AC1: an admin, with current %s: the bar holds Members, Menus, Weeks, Weekly lists, then the switch to ACCOUNT_PATH, then the Sign out form", async (current) => {
      admin();
      const { buttons, forms } = await header("none", current);
      expect(sequence(buttons)).toEqual([...ADMIN_LINKS, ACCOUNT_PATH, SIGN_OUT]);
      expect(forms.map((form) => form.props.action)).toEqual([signOut]);
    });

    it.each(ADMIN_MARKS)("AC1: an admin, with current %s: the four admin links are menu Buttons, and the bar has no MenuGroup", async (current) => {
      admin();
      const { buttons, groups } = await header("none", current);
      expect(buttons.slice(0, ADMIN_LINKS.length).map((button) => [button.props.kind, button.props.href])).toEqual(ADMIN_LINKS.map((href) => ["menu", href]));
      expect(groups).toEqual([]);
    });

    it("AC1: an admin with no active subscription, on an admin page, has no link to a member page in the bar", async () => {
      await adminWithoutSubscription();
      const { buttons } = await header("none", "admin-members");
      expect(sequence(buttons)).toEqual([...ADMIN_LINKS, ACCOUNT_PATH, SIGN_OUT]);
      expect(buttons.filter((button) => MEMBER_PAGES.includes(String(button.props.href)))).toEqual([]);
    });
  });

  describe("AC2 — the Member interface's bar, for an admin", () => {
    it.each(MEMBER_MARKS)("AC2: an admin with an active subscription, with current %s: the bar holds the member links, then the switch to ADMIN_PATH, then the Sign out form, and no MenuGroup", async (current) => {
      admin();
      const { buttons, forms, groups } = await header("none", current);
      expect(sequence(buttons)).toEqual([...LINKS, ADMIN_PATH, SIGN_OUT]);
      expect(forms.map((form) => form.props.action)).toEqual([signOut]);
      expect(groups).toEqual([]);
    });

    it.each(MEMBER_MARKS)("AC2: an admin with no active subscription, with current %s: the bar holds /supper-club and /menu first, then the member links, then the switch to ADMIN_PATH, then the Sign out form, and no MenuGroup", async (current) => {
      await adminWithoutSubscription();
      const { buttons, forms, groups } = await header("none", current);
      expect(sequence(buttons)).toEqual([...FIVE, ADMIN_PATH, SIGN_OUT]);
      expect(forms.map((form) => form.props.action)).toEqual([signOut]);
      expect(groups).toEqual([]);
    });
  });

  describe("AC3 — the page showing is marked, and the switch never is", () => {
    it.each([
      ["admin-members", ADMIN_PATH, ACCOUNT_PATH],
      ["admin-menus", ADMIN_MENUS_PATH, ACCOUNT_PATH],
      ["admin-weeks", ADMIN_WEEKS_PATH, ACCOUNT_PATH],
      ["admin-lists", ADMIN_LISTS_PATH, ACCOUNT_PATH],
      ["account", ACCOUNT_PATH, ADMIN_PATH],
      ["weeks", WEEKS_PATH, ADMIN_PATH],
      ["supper-club", SUPPER_CLUB, ADMIN_PATH],
      ["menu", MENU, ADMIN_PATH],
    ] as const)("AC3: an admin, with current %s: %s alone is marked, in the bar and in the drawer, and the switch to %s is not", async (current, href, switchTo) => {
      await adminWithoutSubscription();
      const { buttons, drawer } = await header("none", current);
      for (const found of [buttons, drawer.buttons]) expect(marked(found)).toEqual([href]);
      expect([barSwitch(buttons)?.props.href, Boolean(barSwitch(buttons)?.props.current)]).toEqual([switchTo, false]);
      expect(drawer.foot.buttons.filter((button) => button.props.href !== undefined).map((button) => [button.props.href, Boolean(button.props.current)])).toEqual([[switchTo, false]]);
    });

    it("AC3: an admin, with no current page: no link is marked, in the bar or in the drawer", async () => {
      await adminWithoutSubscription();
      const { buttons, drawer } = await header("none");
      expect(barSwitch(buttons)?.props.href).toBe(ADMIN_PATH);
      for (const found of [buttons, drawer.buttons]) expect(marked(found)).toEqual([]);
    });
  });

  describe("AC4 — the drawer", () => {
    it.each([
      ["admin-members", "an active subscription", ADMIN_LINKS],
      ["admin-lists", "an active subscription", ADMIN_LINKS],
      [undefined, "an active subscription", LINKS],
      ["account", "an active subscription", LINKS],
      ["admin-members", "no subscription", ADMIN_LINKS],
      [undefined, "no subscription", FIVE],
    ] as const)("AC4: an admin, with current %s and %s: the drawer's nav holds the bar's links in the same order, each a full menu Button, and nothing else", async (current, subscription, expected) => {
      if (subscription === "no subscription") await adminWithoutSubscription();
      else admin();
      const { buttons, drawer } = await header("none", current);
      const rows = navRows(drawer.links.node);
      expect(rows.map((row) => row.type === Button)).toEqual(expected.map(() => true));
      expect(rows.map((row) => [row.props.kind, row.props.href, row.props.full])).toEqual(expected.map((href) => ["menu", href, true]));
      expect(sequence(buttons).slice(0, -2)).toEqual(sequence(rows));
    });

    it.each([
      ["admin-members", ACCOUNT_PATH],
      ["admin-weeks", ACCOUNT_PATH],
      [undefined, ADMIN_PATH],
      ["weeks", ADMIN_PATH],
    ] as const)("AC4: an admin, with current %s: the drawer's foot holds the switch to %s, full width, then the Sign out form", async (current, switchTo) => {
      admin();
      const { drawer } = await header("none", current);
      expect(sequence(drawer.foot.buttons)).toEqual([switchTo, SIGN_OUT]);
      expect(drawer.foot.buttons[0]?.props.full).toBe(true);
      expect(drawer.foot.forms.map((form) => form.props.action)).toEqual([signOut]);
      expect(findAll(drawer.foot.forms[0], Button)).toEqual([drawer.foot.buttons[1]]);
    });
  });

  describe("AC5 — a member who is not an admin, and nobody signed in", () => {
    it.each([...ADMIN_MARKS, ...MEMBER_MARKS])("AC5: a member who is not an admin, with current %s: the member links, then Sign out, in the bar and the drawer, and no switch", async (current) => {
      session.member = { role: "member" };
      const { buttons, groups, drawer } = await header("none", current);
      expect(sequence(buttons)).toEqual([...LINKS, SIGN_OUT]);
      expect(groups).toEqual([]);
      expect(sequence(drawer.links.buttons)).toEqual(LINKS);
      expect(sequence(drawer.foot.buttons)).toEqual([SIGN_OUT]);
    });

    it("AC5: a member who is not an admin, with no active subscription and current admin-members: the five member links, then Sign out, in the bar and the drawer, and no switch", async () => {
      session.member = { ...(await services.repo.createMember({ email: "grace@example.com" })), role: "member" };
      const { buttons, drawer } = await header("none", "admin-members");
      expect(sequence(buttons)).toEqual([...FIVE, SIGN_OUT]);
      expect(sequence(drawer.links.buttons)).toEqual(FIVE);
      expect(sequence(drawer.foot.buttons)).toEqual([SIGN_OUT]);
    });

    it.each(["sign-in", "none"] as const)('AC5: signed out, with account "%s" and current admin-members: the header is the signed-out one, with no drawer', async (account) => {
      const { buttons, drawers } = await header(account, "admin-members");
      expect(sequence(buttons)).toEqual(account === "sign-in" ? [SIGN_IN_PATH] : []);
      expect(drawers).toEqual([]);
    });
  });

  describe("AC6 — where the farm's name goes", () => {
    it.each(ADMIN_MARKS)(`AC6: an admin, with current %s: the farm's name links to ${ADMIN_PATH}`, async (current) => {
      admin();
      expect(wordmarkHref((await header("none", current)).element)).toEqual([ADMIN_PATH]);
    });

    it.each(MEMBER_MARKS)("AC6: an admin, with current %s: the farm's name links to /", async (current) => {
      admin();
      expect(wordmarkHref((await header("none", current)).element)).toEqual(["/"]);
    });

    it.each(["admin-members", "account"] as const)("AC6: a member who is not an admin, with current %s: the farm's name links to /", async (current) => {
      session.member = { role: "member" };
      expect(wordmarkHref((await header("none", current)).element)).toEqual(["/"]);
    });

    it("AC6: signed out, with current admin-members: the farm's name links to /", async () => {
      expect(wordmarkHref((await header("sign-in", "admin-members")).element)).toEqual(["/"]);
    });
  });
});
