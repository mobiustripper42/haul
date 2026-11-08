// Issue 55, AC17 and AC18: the header moved out of app/sign-in/layout.tsx. `await SiteHeader(props)` is read
// as the tree it returns, and as markup for the order of its words, with `next/headers` faked.
// Issue 77, AC4 and AC5: the link goes to the sign-in pane and can be marked current.
// Issue 97, AC3–AC6: the header reads the session itself. Signed out it is as each page sets it with
// `account`; signed in it shows Admin (admins only) and Sign out, whatever `account` says.
// The language switch is faked with a marker, so what is read here is only where the header puts it; its
// own words and buttons are app/language-switcher.test.ts's. The session is faked as a member or an admin;
// who counts as signed in is app/session.test.ts's. The wide-only wrapper for issue 77's AC11 ("below `lg`")
// is measured in the browser, e2e/supper-club.spec.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@core/messages/en.js";
import { Button } from "../components/ui/button";
import { SiteBar } from "../components/ui/site-bar";
import { emptyRequest } from "./next-headers-fake";
import { ADMIN_PATH } from "./paths";
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
vi.mock("./language-switcher", () => ({ LanguageSwitcher: async () => createElement("div", null, "the language switch") }));

beforeEach(() => {
  request.current = emptyRequest();
  session.member = null;
});

const SWITCH = "the language switch";
const BRAND = [en["brand.name"], en["brand.byline"]];
const SIGN_IN = en["home.signIn"];
const SIGN_OUT = en["home.signOut"];
const ADMIN = en["header.admin"];

type Account = "none" | "sign-in" | "sign-in-current";

const header = async (account: Account, current?: "admin") => {
  const element = await SiteHeader({ account, ...(current === undefined ? {} : { current }) });
  return { element, words: textsOf(renderToStaticMarkup(element)), buttons: findAll(element, Button) };
};

describe("AC18 — SiteHeader, account none, is the header the sign-in screens had", () => {
  it("AC18: it holds the farm's name and byline, then the language switch, and no other word", async () => {
    expect((await header("none")).words).toEqual([...BRAND, SWITCH]);
  });

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
  it('AC17, AC4 (issue 77): account "sign-in" adds a secondary "Sign in" link to /supper-club/sign-in after the language switch', async () => {
    const { words, buttons } = await header("sign-in");
    expect(words).toEqual([...BRAND, SWITCH, SIGN_IN]);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props).toMatchObject({ kind: "secondary", href: "/supper-club/sign-in" });
  });

  it("AC17: the Sign in link is not marked as the page showing", async () => {
    expect((await header("sign-in")).buttons[0]?.props.current).toBeFalsy();
  });
});

describe('AC5 (issue 77) — account "sign-in-current"', () => {
  it('AC5: it is the same secondary "Sign in" link, to /supper-club/sign-in, marked as the page showing', async () => {
    const { words, buttons } = await header("sign-in-current");
    expect(words).toEqual([...BRAND, SWITCH, SIGN_IN]);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props).toMatchObject({ kind: "secondary", href: "/supper-club/sign-in", current: true });
  });
});

describe("AC4 (issue 97) — signed in as a member", () => {
  beforeEach(() => {
    session.member = { role: "member" };
  });

  it("AC4: after the language switch the header shows Sign out, and no Admin and no Sign in", async () => {
    expect((await header("sign-in")).words).toEqual([...BRAND, SWITCH, SIGN_OUT]);
  });

  it("AC4: Sign out is a quiet submit button alone in a form whose action is signOut", async () => {
    const { element } = await header("sign-in");
    const forms = findAll(element, "form");
    expect(forms.map((form) => form.props.action)).toEqual([signOut]);
    const buttons = findAll(forms[0], Button);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props).toMatchObject({ kind: "quiet", type: "submit", children: SIGN_OUT });
  });

  it.each(["none", "sign-in", "sign-in-current"] as const)(
    'AC6 (issue 97): with account "%s" the header shows Sign out and no Sign in: account is only the signed-out state',
    async (account) => {
      expect((await header(account)).words).toEqual([...BRAND, SWITCH, SIGN_OUT]);
    },
  );
});

describe("AC5 (issue 97) — signed in as an admin", () => {
  beforeEach(() => {
    session.member = { role: "admin" };
  });

  it("AC5: after the language switch the header shows Admin, then Sign out", async () => {
    expect((await header("sign-in")).words).toEqual([...BRAND, SWITCH, ADMIN, SIGN_OUT]);
  });

  it("AC5: Admin is a secondary link to ADMIN_PATH, not marked current when `current` is not given", async () => {
    const [admin, ...others] = (await header("none")).buttons;
    expect(admin?.props).toMatchObject({ kind: "secondary", href: ADMIN_PATH, children: ADMIN });
    expect(admin?.props.current).toBeFalsy();
    expect(others.map((button) => button.props.children)).toEqual([SIGN_OUT]);
  });

  it('AC5: with current "admin", Admin is marked as the page showing', async () => {
    const [admin] = (await header("none", "admin")).buttons;
    expect(admin?.props).toMatchObject({ href: ADMIN_PATH, current: true });
  });

  it('AC6 (issue 97): with account "sign-in-current" the header still shows Admin, then Sign out', async () => {
    expect((await header("sign-in-current")).words).toEqual([...BRAND, SWITCH, ADMIN, SIGN_OUT]);
  });
});
