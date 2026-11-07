// Issue 63, AC1–AC3: /terms and /privacy, `await Terms()` rendered through react-dom/server with
// `next/headers` faked. As src/email-templates.test.ts, the Spanish catalog is replaced for this whole file by
// a stand-in whose every value is its own key in guillemets, so a Spanish render shows which keys the page
// reads and any English it wrote itself. The stand-in documents and their edits are
// src/legal-text-test-helpers.ts. AC9, the pages against their mockups, is by hand.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { PRIVACY_LINES, TERMS_LINES, wordsOf } from "@core/legal-text-test-helpers.js";
import { signSession } from "@core/sign-in/session.js";
import { Card } from "../components/ui/card";
import { Shell } from "../components/ui/shell";
import { LegalPage } from "./legal-page";
import { emptyRequest } from "./next-headers-fake";
import Privacy from "./privacy/page";
import { attributesOf, escapeRegExp, findAll, normalMarkup, screenMarkup, textsOf, utilitiesOf } from "./screen-test-helpers";
import { SiteHeader } from "./site-header";
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
vi.mock("@core/messages/es.js", async () => {
  const { en } = await import("@core/messages/en.js");
  return { es: Object.fromEntries(Object.keys(en).map((key) => [key, `«${key}»`])) };
});

const LAST_UPDATED = "Last updated [DATE]";

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

const signIn = async () => {
  const member = await services.repo.createMember({ email: "ada@example.com" });
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  request.current.cookies = { ocf_session: signSession({ subjectId: member.id, expiresAt }, services.secret) };
};

const mainOf = (html: string) => /<main\b[\s\S]*<\/main>/.exec(html)?.[0] ?? "";

/** Each `h2`, `p` and `li` in the card, in order, as [tag, words]. */
const blocksOf = (html: string) =>
  [...screenMarkup(mainOf(html)).matchAll(/<(h2|p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(([, tag, words]) => [tag, words]);

/** What a document's line should render as. */
const blockFor = (line: string) => [line.startsWith("## ") ? "h2" : line.startsWith("- ") ? "li" : "p", wordsOf(line)];

const render = async (page: () => Promise<ReactNode>) => renderToStaticMarkup(await page());

describe.each([
  ["AC1", "/terms", Terms, "Terms of service", TERMS_LINES],
  ["AC2", "/privacy", Privacy, "Privacy policy", PRIVACY_LINES],
] as const)("%s — %s", (ac, path, page, title, lines) => {
  it(`${ac}: ${path} reads "${title}", then "${LAST_UPDATED}", then the document, line for line`, async () => {
    expect(textsOf(mainOf(await render(page)))).toEqual([title, LAST_UPDATED, ...lines.map(wordsOf)]);
  });

  it(`${ac}: each heading is an h2, each paragraph a p and each bullet an li, in the document's order`, async () => {
    expect(blocksOf(await render(page))).toEqual(lines.map(blockFor));
  });

  it(`${ac}: it works signed in as it does signed out`, async () => {
    const signedOut = await render(page);
    expect(textsOf(signedOut)).toContain(title);
    await signIn();
    expect(mainOf(await render(page))).toBe(mainOf(signedOut));
  });

  it(`${ac}: it opens with the header that has no account link`, async () => {
    const header = renderToStaticMarkup(await SiteHeader({ account: "none" }));
    expect(normalMarkup(await render(page)).startsWith(normalMarkup(header))).toBe(true);
  });

  it(`${ac}: it is one Shell holding one reading-width Card`, async () => {
    const element = await page();
    expect(findAll(element, Shell)).toHaveLength(1);
    expect(findAll(element, Card).map((card) => card.props.width)).toEqual(["reading"]);
  });

  it(`${ac}: the title is the page's h1, and the date line is a hint under it`, async () => {
    const html = await render(page);
    const line = escapeRegExp(LAST_UPDATED);
    expect(screenMarkup(mainOf(html))).toMatch(new RegExp(`<h1\\b[^>]*>${title}</h1>\\s*<span\\b[^>]*>${line}</span>`));
    const hint = new RegExp(`<span\\b[^>]*class="([^"]*)"[^>]*>${line}</span>`).exec(screenMarkup(html))?.[1];
    expect(utilitiesOf(hint)).toContain("text-ink-muted");
  });
});

describe("AC2 — the Privacy Policy's opening on the page", () => {
  it("AC2: the opening paragraph stands before the first heading", async () => {
    const blocks = blocksOf(await render(Privacy));
    expect(blocks[0]?.[0]).toBe("p");
    expect(blocks[0]?.[1]).toMatch(/^This policy explains what information/);
    expect(blocks[1]).toEqual(["h2", "What we collect"]);
  });
});

describe.each([
  ["/terms", Terms, "legal.terms"],
  ["/privacy", Privacy, "legal.privacy"],
] as const)("AC3 — %s", (path, page, keys) => {
  it(`AC3: ${path} shows no #, no * and no backslash`, async () => {
    const words = textsOf(mainOf(await render(page))).join("\n");
    expect(words).toContain(LAST_UPDATED);
    expect(words).not.toMatch(/[#*\\]/);
  });

  it(`AC3: ${path} shows the brackets the edits leave, as they stand, and none the edits remove`, async () => {
    const words = textsOf(mainOf(await render(page))).join("\n");
    expect(words).toContain("[CONTACT EMAIL]");
    expect(words).toContain("[LEGAL NAME OF RE:SOURCE CLEVELAND]");
    for (const gone of ["[14]", "[EFFECTIVE DATE]", "Effective", "Nov 6, 2026", "@Eric"]) expect(words).not.toContain(gone);
  });

  it(`AC3: in the stand-in catalog ${path} shows only catalog values, nothing the page wrote itself`, async () => {
    request.current.cookies = { lang: "es" };
    expect(textsOf(mainOf(await render(page)))).toEqual([`«${keys}.title»`, "«legal.lastUpdated»", `«${keys}.text»`]);
  });
});

describe("AC1 — LegalPage, the one layout", () => {
  const TEXT = "Before the first.\n\n## One\n\nA line.\n\n- Two\n- Three";
  const html = async () => renderToStaticMarkup(await LegalPage({ title: "A title", text: TEXT }));

  it("AC1: it lays out the title and text it is given, the blocks in order", async () => {
    expect(textsOf(mainOf(await html()))).toEqual(["A title", LAST_UPDATED, "Before the first.", "One", "A line.", "Two", "Three"]);
  });

  it("AC1: a heading is Heading level 2, the section type style", async () => {
    expect(utilitiesOf(attributesOf(await html(), "h2")[0]?.class)).toEqual(expect.arrayContaining(["font-display", "text-section", "text-teal"]));
  });

  it("AC1: a list is one BulletList, the look of the Supper Club's list", async () => {
    const lists = attributesOf(await html(), "ul");
    expect(lists).toHaveLength(1);
    expect(utilitiesOf(lists[0]?.class)).toEqual(expect.arrayContaining(["list-disc", "pl-5"]));
  });
});
