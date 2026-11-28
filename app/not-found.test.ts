// Issue 271, AC6 and AC7: the Not Found page, `await NotFound()` rendered through react-dom/server with `next/headers`
// faked. That a URL with no page answers 404 with it, and that a page calling `notFound()` shows it (AC8), only the real
// server shows (e2e/not-found.spec.ts). The signed-in-or-not rule's cases are `homePath()`'s (app/home-path.test.ts);
// here one case each way, read through the real session. SiteHeader is faked: its own markup is the header's tests'; here
// it is read as the call the page makes. The translator is a stand-in that writes each key in guillemets, so the link's
// line is read by the key it shows, and no test reads the page's words.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { signSession } from "@core/sign-in/session.js";
import { Card } from "../components/ui/card";
import { Shell } from "../components/ui/shell";
import { emptyRequest } from "./next-headers-fake";
import NotFound from "./not-found";
import { ACCOUNT_PATH } from "./paths";
import { attributesOf, findAll, textsOf } from "./screen-test-helpers";
import { SiteHeader } from "./site-header";
import { SUPPER_CLUB_PATH } from "./supper-club/paths";

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
vi.mock("./language", () => ({
  getLanguage: async () => "en",
  getTranslator: async () => (key: string) => `«${key}»`,
}));
vi.mock("./site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.mocked(SiteHeader).mockClear();
});

async function signInAsMember(): Promise<void> {
  const member = await services.repo.createMember({ email: "ada@example.com", role: "member" });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
}

const mainOf = (html: string) => /<main\b[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
/** Every link in `html`, as its address and its runs of text. */
const linksOf = (html: string) =>
  [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(([markup]) => ({ href: attributesOf(markup, "a")[0]?.href, texts: textsOf(markup) }));

const render = async () => {
  const element = await NotFound();
  return { element, html: renderToStaticMarkup(element) };
};

describe("AC6 (issue 271) — the Not Found page", () => {
  it("AC6: it opens with the site header with its Sign in, nothing marked", async () => {
    const { html } = await render();
    expect(textsOf(html)[0]).toBe("the header");
    expect(SiteHeader).toHaveBeenCalledTimes(1);
    expect(SiteHeader).toHaveBeenCalledWith({ account: "sign-in" });
  });

  it("AC6: below the header is one Shell holding one Card", async () => {
    const { element } = await render();
    expect(findAll(element, Shell)).toHaveLength(1);
    expect(findAll(element, Card)).toHaveLength(1);
  });

  it("AC6: the card is a title, one line and one link onward, and nothing else", async () => {
    const main = mainOf((await render()).html);
    expect(main.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(linksOf(main)).toHaveLength(1);
    expect(textsOf(main)).toHaveLength(3);
  });
});

describe("AC7 (issue 271) — the link onward follows who is signed in", () => {
  it(`AC7: signed out, the one link goes to ${SUPPER_CLUB_PATH} and reads the to-the-Supper-Club line`, async () => {
    expect(linksOf(mainOf((await render()).html))).toEqual([{ href: SUPPER_CLUB_PATH, texts: ["«notFound.toSupperClub»"] }]);
  });

  it(`AC7: signed in as a member, the one link goes to ${ACCOUNT_PATH} and reads the to-Your-account line`, async () => {
    await signInAsMember();
    expect(linksOf(mainOf((await render()).html))).toEqual([{ href: ACCOUNT_PATH, texts: ["«notFound.toAccount»"] }]);
  });
});
