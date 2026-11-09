// Issue 101, AC1: every page route's `document.title` is its screen's heading, then " · Ohio City Farm",
// translated. `titled` owns the shape and the language; each page's own `generateMetadata` is read here
// for the heading it names. The headings are the catalog's (`en`); the shape is the criterion's own words.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en, type MessageKey } from "@core/messages/en.js";
import { es } from "@core/messages/es.js";
import { emptyRequest } from "./next-headers-fake";
import { titled } from "./page-title";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("./screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("./services", () => ({
  getRepository: () => {
    throw new Error("a page's title has no reason to read the repository");
  },
  getEmail: () => {
    throw new Error("a page's title has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
  getSiteUrl: () => "https://members.example.test",
  getFarmContactEmail: () => undefined,
  isProduction: () => false,
}));

beforeEach(() => {
  request.current = emptyRequest();
});

// The one Spanish string the catalog holds today; a heading Spanish lacks falls back to English, so only this
// key can show the title following the language.
const SPANISH_KEY = "language.label";

describe("AC1 — titled", () => {
  it('AC1: titled(key) resolves to { title: "<heading> · Ohio City Farm" }', async () => {
    expect(await titled("signIn.codeTitle")()).toEqual({ title: `${en["signIn.codeTitle"]} · Ohio City Farm` });
  });

  it("AC1: the title is in the request's language: with the lang cookie es, the Spanish heading", async () => {
    request.current.cookies = { lang: "es" };
    expect(await titled(SPANISH_KEY)()).toEqual({ title: `${es[SPANISH_KEY]} · Ohio City Farm` });
  });

  it("AC1: the language is read per request, not when titled is called", async () => {
    const title = titled(SPANISH_KEY);
    request.current.cookies = { lang: "es" };
    expect(await title()).toEqual({ title: `${es[SPANISH_KEY]} · Ohio City Farm` });
    request.current.cookies = { lang: "en" };
    expect(await title()).toEqual({ title: `${en[SPANISH_KEY]} · Ohio City Farm` });
  });
});

/** Each page route, its module, and the heading its title reuses. */
const PAGES: ReadonlyArray<readonly [string, () => Promise<{ generateMetadata?: unknown }>, MessageKey]> = [
  ["/sign-in", () => import("./sign-in/page"), "signIn.title"],
  ["/supper-club/sign-in", () => import("./supper-club/sign-in/page"), "signIn.title"],
  ["/sign-in/code", () => import("./sign-in/code/page"), "signIn.codeTitle"],
  ["/supper-club/sign-in/code", () => import("./supper-club/sign-in/code/page"), "signIn.codeTitle"],
  ["/sign-in/link", () => import("./sign-in/link/page"), "signIn.title"],
  ["/create-account", () => import("./create-account/page"), "createAccount.title"],
  ["/supper-club/create-account", () => import("./supper-club/create-account/page"), "createAccount.title"],
  ["/create-account/code", () => import("./create-account/code/page"), "createAccount.codeTitle"],
  ["/supper-club/create-account/code", () => import("./supper-club/create-account/code/page"), "createAccount.codeTitle"],
  ["/supper-club", () => import("./supper-club/page"), "supperClub.joinTitle"],
  ["/supper-club/done", () => import("./supper-club/done/page"), "supperClub.done.title"],
  ["/supper-club/already", () => import("./supper-club/already/page"), "supperClub.already.title"],
  ["/admin", () => import("./admin/page"), "admin.members.title"],
  ["/terms", () => import("./terms/page"), "legal.terms.title"],
  ["/privacy", () => import("./privacy/page"), "legal.privacy.title"],
];

describe("AC1 — each page's title", () => {
  it.each(PAGES)("AC1: %s is titled with its heading", async (_route, load, key) => {
    const { generateMetadata } = await load();
    expect(typeof generateMetadata).toBe("function");
    const metadata = await (generateMetadata as () => Promise<unknown>)();
    expect(metadata).toEqual({ title: `${en[key]} · ${en["brand.name"]}` });
  });
});
