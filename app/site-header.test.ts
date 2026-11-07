// Issue 55, AC17 and AC18: the header moved out of app/sign-in/layout.tsx. `await SiteHeader(props)`
// rendered through react-dom/server with `next/headers` faked, as app/sign-in/layout.test.ts renders it.
// Issue 77, AC4, AC5 and AC11: the link goes to the sign-in pane, can be marked current, and can be wide-only.
// Issue 97, AC3–AC6: the header reads the session itself. Signed out it is as each page sets it with
// `account`; signed in it shows Admin (admins only) and Sign out, whatever `account` says. A signed-in
// request is an ocf_session cookie for a member in an InMemoryRepository, the composition root mocked.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Role } from "@core/members.js";
import { signSession } from "@core/sign-in/session.js";
import { SiteBar } from "../components/ui/site-bar";
import CreateAccountLayout from "./create-account/layout";
import { setLanguage } from "./language-actions";
import { emptyRequest } from "./next-headers-fake";
import { ADMIN_PATH } from "./paths";
import { attributesOf, findAll, normalMarkup, screenMarkup, textsOf, utilitiesOf } from "./screen-test-helpers";
import { SiteHeader } from "./site-header";
import { signOut } from "./sign-in/actions";
import SignInLayout from "./sign-in/layout";
import Terms from "./terms/page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("./screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("./services", () => ({ getRepository: () => services.repo, getSessionSecret: () => services.secret }));

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

async function signInAs(role: Role): Promise<void> {
  const member = await services.repo.createMember({ email: "ada@example.com", role });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
}

type Account = "none" | "sign-in" | "sign-in-current";

const BRAND_AND_SWITCH = ["Ohio City Farm", "by Re:Source Cleveland", "Language", "English", "Español"];
const render = async (account: Account, wideOnly?: boolean) =>
  renderToStaticMarkup(await SiteHeader({ account, ...(wideOnly === undefined ? {} : { wideOnly }) }));

/** The one <header> in a page's markup. */
const headerOf = (html: string) => /<header\b[\s\S]*<\/header>/.exec(html)?.[0] ?? "";

describe("AC18 — SiteHeader, account none, is the header the sign-in screens had", () => {
  it("AC18: it renders one <header> holding the brand link to / and the language switch, and no other link", async () => {
    const html = await render("none");
    expect(screenMarkup(html)).toMatch(/^<header\b/);
    expect(textsOf(html)).toEqual(BRAND_AND_SWITCH);
    expect(attributesOf(html, "a").map((link) => link.href)).toEqual(["/"]);
  });

  it("AC18: the sign-in layout is that header, then its children", async () => {
    const child = createElement("p", null, "child");
    const header = await render("none");
    expect(textsOf(header), "SiteHeader renders nothing yet").toEqual(BRAND_AND_SWITCH);
    const layout = renderToStaticMarkup(await SignInLayout({ children: child }));
    expect(normalMarkup(layout)).toBe(normalMarkup(`${header}<p>child</p>`));
  });
});

describe("AC17 — SiteHeader's account link", () => {
  it('AC17, AC4 (issue 77): account "sign-in" adds a secondary "Sign in" link to /supper-club/sign-in after the language switch', async () => {
    const html = await render("sign-in");
    expect(textsOf(html)).toEqual([...BRAND_AND_SWITCH, "Sign in"]);
    const [, link] = attributesOf(html, "a");
    expect(link?.href).toBe("/supper-club/sign-in");
    expect(utilitiesOf(link?.class)).toContain("btn-secondary");
    expect(link).not.toHaveProperty("aria-current");
  });
});

describe('AC5 (issue 77) — account "sign-in-current"', () => {
  it('AC5: it is the same secondary "Sign in" link, to /supper-club/sign-in, marked aria-current="page"', async () => {
    const html = await render("sign-in-current");
    expect(textsOf(html)).toEqual([...BRAND_AND_SWITCH, "Sign in"]);
    const [, link] = attributesOf(html, "a");
    expect(link).toMatchObject({ href: "/supper-club/sign-in", "aria-current": "page" });
    expect(utilitiesOf(link?.class)).toContain("btn-secondary");
  });
});

describe("AC11 (issue 77) — wideOnly", () => {
  it.each(["sign-in", "sign-in-current"] as const)("AC11: with %s the account link sits in the wide-only wrapper, and the language switch does not", async (account) => {
    const markup = screenMarkup(await render(account, true));
    expect(markup).toMatch(/<\w+\b[^>]*class="[^"]*(?<![\w-])wide-only(?![\w-])[^"]*"[^>]*>\s*<a\b[^>]*>Sign in<\/a>/);
    expect(markup.indexOf("wide-only")).toBeGreaterThan(markup.indexOf("</fieldset>"));
  });

  it("AC11: without it the link is not wide-only", async () => {
    const html = await render("sign-in");
    expect(textsOf(html)).toContain("Sign in");
    expect(html).not.toContain("wide-only");
  });
});

describe("AC3 (issue 97) — signed out, the header's frame", () => {
  it("AC3: SiteHeader renders through SiteBar, as the header", async () => {
    expect(findAll(await SiteHeader({ account: "none" }), SiteBar).map((bar) => bar.props.as)).toEqual(["header"]);
  });
});

describe("AC4 (issue 97) — signed in as a member", () => {
  beforeEach(async () => {
    await signInAs("member");
  });

  it('AC4: after the language switch the header shows Sign out, and no "Your account", no Admin and no Sign in', async () => {
    expect(textsOf(await render("sign-in"))).toEqual([...BRAND_AND_SWITCH, "Sign out"]);
  });

  it("AC4: Sign out is a submit button alone in a form whose action is signOut, after the switch's form", async () => {
    const element = await SiteHeader({ account: "sign-in" });
    expect(findAll(element, "form").map((form) => form.props.action)).toEqual([setLanguage, signOut]);
    expect(screenMarkup(renderToStaticMarkup(element))).toMatch(
      /<\/fieldset>\s*<\/form>[\s\S]*<form\b[^>]*>\s*<button\b(?=[^>]*\btype="submit")[^>]*>Sign out<\/button>\s*<\/form>/,
    );
  });
});

describe("AC5 (issue 97) — signed in as an admin", () => {
  beforeEach(async () => {
    await signInAs("admin");
  });

  it("AC5: after the language switch the header shows Admin, then Sign out", async () => {
    expect(textsOf(await render("sign-in"))).toEqual([...BRAND_AND_SWITCH, "Admin", "Sign out"]);
  });

  it("AC5: Admin is a secondary link to ADMIN_PATH, /admin, not marked current when `current` is not given", async () => {
    const [, link, ...others] = attributesOf(await render("none"), "a");
    expect(ADMIN_PATH).toBe("/admin");
    expect(link?.href).toBe(ADMIN_PATH);
    expect(utilitiesOf(link?.class)).toContain("btn-secondary");
    expect(link).not.toHaveProperty("aria-current");
    expect(others).toEqual([]);
  });

  it('AC5: with current "admin", Admin is marked as the page showing, aria-current="page"', async () => {
    const [, link] = attributesOf(renderToStaticMarkup(await SiteHeader({ account: "none", current: "admin" })), "a");
    expect(link).toMatchObject({ href: "/admin", "aria-current": "page" });
  });
});

describe("AC6 (issue 97) — signed in, every page's header shows the buttons", () => {
  it.each(["none", "sign-in-current"] as const)('AC6: with account "%s", a member\'s header shows Sign out and no Sign in: account is only the signed-out state', async (account) => {
    await signInAs("member");
    expect(textsOf(await render(account))).toEqual([...BRAND_AND_SWITCH, "Sign out"]);
  });

  it.each([
    ["the sign-in layout", async () => SignInLayout({ children: createElement("p", null, "child") })],
    ["the create-account layout", async () => CreateAccountLayout({ children: createElement("p", null, "child") })],
    ["the Terms page (LegalPage)", async () => Terms()],
  ])("AC6: on %s, an admin's header shows Admin, then Sign out", async (_page, page) => {
    await signInAs("admin");
    const header = headerOf(renderToStaticMarkup(await page()));
    expect(textsOf(header)).toEqual([...BRAND_AND_SWITCH, "Admin", "Sign out"]);
  });
});
