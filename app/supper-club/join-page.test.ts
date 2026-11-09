// Issue 77: JoinPage, the one home for the Supper Club's header, shell and left column, takes over what
// app/supper-club/layout.test.ts pinned (AC2 and AC3 of issue 55: the header by who is signed in), and
// BackToChoices. `await JoinPage(props)` rendered through react-dom/server with `next/headers` faked.
// SiteHeader is faked: its markup (the Sign in link's path, aria-current, wide-only, Sign out) is
// app/site-header.test.ts's, and here is read what JoinPage asks it for. What a width does to the page
// (AC3 and AC11 at lg and below) is measured in e2e/supper-club.spec.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { en } from "@core/messages/en.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../next-headers-fake";
import { findAll, redirectOf, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import { BulletList } from "../../components/ui/bullet-list";
import { Button } from "../../components/ui/button";
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
vi.mock("../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

const CHILD = createElement("p", null, "child");
const RETURN_TO = "ocf_return_to";

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.mocked(SiteHeader).mockClear();
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

describe("no pane: the Supper Club page", () => {
  it('AC4: signed out it opens with the header asked for with account "sign-in", at every width', async () => {
    const { html } = await render("none");
    expect(SiteHeader).toHaveBeenCalledWith({ account: "sign-in", wideOnly: false });
    expect(textsOf(html)[0]).toBe("the header");
  });

  // Issue 97: signed in, the header reads the session itself, whatever `account` JoinPage passes.
  it("AC4 (issue 97): signed in it redirects nowhere, and asks for the same header", async () => {
    await signIn();
    const { html } = await render("none");
    expect(SiteHeader).toHaveBeenCalledWith({ account: "sign-in", wideOnly: false });
    expect(textsOf(html).slice(-1)).toEqual(["child"]);
  });

  it("AC3: it is the page shell, with the slot last (the left column's card: AC17 below)", async () => {
    const { element, html } = await render("none");
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["page"]);
    expect(textsOf(html).slice(-1)).toEqual(["child"]);
  });
});

describe.each(["create-account", "sign-in"] as const)("pane %s", (pane) => {
  it(`AC3: ${pane} is the pane shell, with the slot last (the left column's card: AC17 below)`, async () => {
    const { element, html } = await render(pane);
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["pane"]);
    expect(textsOf(html).slice(-1)).toEqual(["child"]);
  });

  it(`AC11: ${pane} asks for a header whose Sign in is wide-only`, async () => {
    await render(pane);
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ wideOnly: true }));
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

  it(`AC13: ${pane} is the pane shell, with the slot last (the left column's card: AC17 below)`, async () => {
    await signIn();
    const { element, html } = await render(pane);
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["pane"]);
    expect(textsOf(html).slice(-1)).toEqual(["child"]);
  });

  it(`AC4 (issue 97): ${pane}'s header shows at every width`, async () => {
    await signIn();
    await render(pane);
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ wideOnly: false }));
  });
});

describe("AC5 — the header's Sign in marked current", () => {
  it('AC5: on the sign-in pane the header is asked for with "sign-in-current"', async () => {
    await render("sign-in");
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ account: "sign-in-current" }));
  });

  it('AC5: on the Create Account pane it is asked for with "sign-in", not current', async () => {
    await render("create-account");
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ account: "sign-in" }));
  });
});

describe("AC6 — BackToChoices", () => {
  const backLink = async () => {
    const [link] = findAll(await BackToChoices(), Button);
    return link;
  };

  it('AC6: it reads "Back to your choices", a quiet back link', async () => {
    const link = await backLink();
    expect(link?.props.children).toBe(en["supperClub.backToChoices"]);
    expect(link?.props).toMatchObject({ kind: "quiet", back: true });
  });

  it("AC6: it goes to the return path in the cookie", async () => {
    request.current.cookies = { [RETURN_TO]: "/supper-club?size=four&menu=vegan" };
    expect((await backLink())?.props.href).toBe("/supper-club?size=four&menu=vegan");
  });

  it("AC6: with no cookie it goes to /supper-club", async () => {
    expect((await backLink())?.props.href).toBe("/supper-club");
  });

  it("AC6: an unsafe value gives /", async () => {
    request.current.cookies = { [RETURN_TO]: "//evil.com" };
    expect((await backLink())?.props.href).toBe("/");
  });
});

describe("AC1 (issue 63) — the list's look has one home", () => {
  it("AC1: the left column's every-week list is a BulletList of the five items in the catalog", async () => {
    const { element } = await render("none");
    expect(findAll(element, BulletList).map((list) => list.props.items)).toEqual([
      [
        en["supperClub.item.protein"],
        en["supperClub.item.grain"],
        en["supperClub.item.veggie"],
        en["supperClub.item.salad"],
        en["supperClub.item.soup"],
      ],
    ]);
  });
});

describe("AC17 — the page's cards fill their columns", () => {
  it.each(["none", "create-account", "sign-in", "done", "already"] as const)('AC17: on pane %s the left column\'s card uses width="fill"', async (pane) => {
    if (pane === "done" || pane === "already") await signIn();
    const { element } = await render(pane);
    expect(findAll(element, Card).map((card) => card.props.width)).toEqual(["fill"]);
  });
});
