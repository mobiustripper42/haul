// Issue 101, AC1: every page route's `document.title` is its screen's heading, then " · Ohio City Farm",
// translated. `titled` owns the shape and the language; every `page.tsx` under app/ is found and read here
// for a title in that shape (issue 121). Which heading a page names is its own one line, not tested.
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@core/messages/en.js";
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

const APP = fileURLToPath(new URL(".", import.meta.url));

/** `/` only redirects to the Supper Club (`page.tsx`), so it has no screen and no heading to title. */
const UNTITLED = ["page.tsx"];

/** Every page route's file under app/, by path from app/. */
const pageFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === "page.tsx" ? [relative(APP, path).split(sep).join("/")] : [];
  });

const HEADINGS = new Set<string>(Object.values(en));

describe("AC1 — every page's title", () => {
  it("AC1: each untitled page is still a page", () => {
    expect(pageFiles(APP)).toEqual(expect.arrayContaining(UNTITLED));
  });

  it.each(pageFiles(APP).filter((file) => !UNTITLED.includes(file)))(
    'AC1: %s is titled "<a catalog heading> · Ohio City Farm"',
    async (file) => {
      const { generateMetadata } = (await import(join(APP, file))) as { generateMetadata?: () => Promise<{ title?: unknown }> };
      expect(typeof generateMetadata).toBe("function");
      const { title } = await generateMetadata!();
      const suffix = ` · ${en["brand.name"]}`;
      expect(String(title).endsWith(suffix)).toBe(true);
      expect(HEADINGS.has(String(title).slice(0, -suffix.length))).toBe(true);
    },
  );
});
