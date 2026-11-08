// Issue 77: JoinPage, the one home for the Supper Club's header, shell and left column, takes over what
// app/supper-club/layout.test.ts pinned (AC2 and AC3 of issue 55: the header by who is signed in), and
// BackToChoices. `await JoinPage(props)` rendered through react-dom/server with `next/headers` faked.
import { existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, findAll, normalMarkup, redirectOf, screenMarkup, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import { BulletList } from "../../components/ui/bullet-list";
import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
import { BackToChoices, JoinPage } from "./join-page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({ getRepository: () => services.repo, getSessionSecret: () => services.secret }));

const CHILD = createElement("p", null, "child");
const RETURN_TO = "ocf_return_to";
const TITLE = "Weekly meals from the farm kitchen";

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

const signIn = async () => {
  const member = await services.repo.createMember({ email: "ada@example.com" });
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  request.current.cookies = { ...request.current.cookies, ocf_session: signSession({ subjectId: member.id, expiresAt }, services.secret) };
};

const render = async (pane: "none" | "create-account" | "sign-in" | "done" | "already") => {
  const element = await JoinPage({ pane, children: CHILD });
  return { element, html: renderToStaticMarkup(element) };
};

const headerOf = (html: string) => /<header\b[\s\S]*<\/header>/.exec(html)?.[0] ?? "";
const linksIn = (html: string) => attributesOf(headerOf(html), "a");

describe("no pane: the Supper Club page", () => {
  it('AC4: signed out it opens with SiteHeader\'s "sign-in" header', async () => {
    const { html } = await render("none");
    const header = renderToStaticMarkup(await SiteHeader({ account: "sign-in" }));
    expect(textsOf(header)).toContain("Sign in");
    expect(normalMarkup(html).startsWith(normalMarkup(header))).toBe(true);
  });

  // Issue 97: signed in, the header reads the session itself, whatever `account` JoinPage passes.
  it("AC4 (issue 97): signed in it opens with SiteHeader's signed-in header, Sign out and no Sign in or \"Your account\", and redirects nowhere", async () => {
    await signIn();
    const { html } = await render("none");
    const header = renderToStaticMarkup(await SiteHeader({ account: "sign-in" }));
    expect(textsOf(header)).toContain("Sign out");
    expect(textsOf(header)).not.toContain("Sign in");
    expect(textsOf(header)).not.toContain("Your account");
    expect(normalMarkup(html).startsWith(normalMarkup(header))).toBe(true);
  });

  it("AC3: it is the page shell, with the left column and then the slot", async () => {
    const { element, html } = await render("none");
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["page"]);
    const texts = textsOf(html);
    expect(texts.slice(-1)).toEqual(["child"]);
    expect(texts).toContain(TITLE);
  });

  it("AC11: nothing is wide-only: on a phone the page keeps its left column and header link", async () => {
    const { html } = await render("none");
    expect(textsOf(html)).toContain(TITLE);
    expect(html).not.toContain("wide-only");
  });
});

describe.each(["create-account", "sign-in"] as const)("pane %s", (pane) => {
  it(`AC3: ${pane} is the pane shell, with the left column and then the slot`, async () => {
    const { element, html } = await render(pane);
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["pane"]);
    const texts = textsOf(html);
    expect(texts.slice(-1)).toEqual(["child"]);
    expect(texts).toContain(TITLE);
  });

  it(`AC11: ${pane}'s left column is wide-only, and the slot is not`, async () => {
    const markup = screenMarkup((await render(pane)).html);
    expect(markup).toMatch(/<main\b[^>]*>\s*<\w+\b[^>]*class="[^"]*(?<![\w-])wide-only(?![\w-])/);
    expect(markup).toMatch(/<p>child<\/p>/);
    expect(markup.slice(markup.lastIndexOf("wide-only"))).toContain(TITLE);
  });

  it(`AC11: ${pane}'s header link is wide-only`, async () => {
    expect(headerOf((await render(pane)).html)).toMatch(/wide-only[^>]*>\s*<a\b[^>]*>Sign in<\/a>/);
  });

  it(`AC4: ${pane}'s header "Sign in" goes to /supper-club/sign-in`, async () => {
    expect(linksIn((await render(pane)).html).map((link) => link.href)).toEqual(["/", "/supper-club/sign-in"]);
  });

  it(`AC12: a signed-in member on ${pane} is redirected to /supper-club`, async () => {
    await signIn();
    expect(await redirectOf(JoinPage({ pane, children: CHILD }))).toBe("/supper-club");
  });
});

describe.each(["done", "already"] as const)("issue 56 — pane %s", (pane) => {
  it(`AC5: a signed-in member on ${pane} is not sent away: the pane is for them`, async () => {
    await signIn();
    expect(textsOf((await render(pane)).html).slice(-1)).toEqual(["child"]);
  });

  it(`AC13: ${pane} is the pane shell, with the left column and then the slot`, async () => {
    await signIn();
    const { element, html } = await render(pane);
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["pane"]);
    expect(textsOf(html)).toContain(TITLE);
  });

  it(`AC13: ${pane}'s left column is wide-only, so a phone gets the slot alone`, async () => {
    await signIn();
    const markup = screenMarkup((await render(pane)).html);
    expect(markup).toMatch(/<main\b[^>]*>\s*<\w+\b[^>]*class="[^"]*(?<![\w-])wide-only(?![\w-])/);
  });

  it(`AC4 (issue 97): ${pane}'s header shows Sign out and no "Your account", at every width`, async () => {
    await signIn();
    const header = headerOf((await render(pane)).html);
    expect(textsOf(header)).toContain("Sign out");
    expect(textsOf(header)).not.toContain("Your account");
    expect(header).not.toContain("wide-only");
  });
});

describe("AC5 — the header's Sign in marked current", () => {
  it('AC5: on the sign-in pane it is aria-current="page"', async () => {
    const [, link] = linksIn((await render("sign-in")).html);
    expect(link).toMatchObject({ href: "/supper-club/sign-in", "aria-current": "page" });
  });

  it("AC5: on the Create Account pane it is not", async () => {
    const [, link] = linksIn((await render("create-account")).html);
    expect(link?.href).toBe("/supper-club/sign-in");
    expect(link).not.toHaveProperty("aria-current");
  });
});

describe("AC6 — BackToChoices", () => {
  const backLink = async () => attributesOf(renderToStaticMarkup(await BackToChoices()), "a")[0];

  it('AC6: it reads "Back to your choices", a quiet back link', async () => {
    const html = renderToStaticMarkup(await BackToChoices());
    expect(textsOf(html)).toEqual(["Back to your choices"]);
    expect(attributesOf(html, "a")[0]?.class).toMatch(/(?<![\w-])btn-quiet(?![\w-])[\s\S]*back-link/);
  });

  it("AC6: it goes to the return path in the cookie", async () => {
    request.current.cookies = { [RETURN_TO]: "/supper-club?size=four&menu=vegan" };
    expect((await backLink())?.href).toBe("/supper-club?size=four&menu=vegan");
  });

  it("AC6: with no cookie it goes to /supper-club", async () => {
    expect((await backLink())?.href).toBe("/supper-club");
  });

  it("AC6: an unsafe value gives /", async () => {
    request.current.cookies = { [RETURN_TO]: "//evil.com" };
    expect((await backLink())?.href).toBe("/");
  });

  it("AC11: it sits in the wide-only wrapper", async () => {
    expect(screenMarkup(renderToStaticMarkup(await BackToChoices()))).toMatch(/^<\w+\b[^>]*class="[^"]*(?<![\w-])wide-only(?![\w-])[^"]*"[^>]*>\s*<a\b/);
  });
});

describe("AC1 (issue 63) — the list's look has one home", () => {
  it("AC1: the left column's every-week list is a BulletList of the same five items", async () => {
    const { element } = await render("none");
    expect(findAll(element, BulletList).map((list) => list.props.items)).toEqual([
      ["Protein main, standard or vegan", "Grain or bread", "Veggie side", "Salad", "Soup or stew"],
    ]);
  });
});

describe("AC17 — the page's cards fill their columns", () => {
  it('AC17: the left column\'s card uses width="fill"', async () => {
    const { element } = await render("none");
    expect(findAll(element, Card).map((card) => card.props.width)).toEqual(["fill"]);
  });
});

describe("the Supper Club layout is gone", () => {
  it("AC5: no layout renders a header over JoinPage's, which AC5 and AC11 need per page", () => {
    expect(existsSync(new URL("./layout.tsx", import.meta.url))).toBe(false);
  });
});
