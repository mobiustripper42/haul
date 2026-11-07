// Issue 97, AC7: the footer every page ends with. `await SiteFooter()` rendered through react-dom/server
// with `next/headers` faked, as app/site-header.test.ts renders the header. FARM_CONTACT_EMAIL is set and
// unset in the environment, which is what `getFarmContactEmail()` reads.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVACY_PATH, TERMS_PATH } from "@core/legal-documents.js";
import { en } from "@core/messages/en.js";
import { SiteBar } from "../components/ui/site-bar";
import { emptyRequest } from "./next-headers-fake";
import { attributesOf, escapeRegExp, findAll, screenMarkup, textsOf, utilitiesOf } from "./screen-test-helpers";
import { SiteFooter } from "./site-footer";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});

const ADDRESS = "Ohio City Farm · 2304 Bridge Ave, Cleveland, OH";
const CONTACT = "farm@ohiocityfarm.test";

beforeEach(() => {
  request.current = emptyRequest();
  vi.stubEnv("FARM_CONTACT_EMAIL", CONTACT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const render = async () => {
  const element = await SiteFooter();
  return { element, html: renderToStaticMarkup(element) };
};

describe("AC7 — the footer", () => {
  it("AC7: it is one <footer>, rendered through SiteBar as the footer", async () => {
    const { element, html } = await render();
    expect(findAll(element, SiteBar).map((bar) => bar.props.as)).toEqual(["footer"]);
    expect(screenMarkup(html)).toMatch(/^<footer\b[\s\S]*<\/footer>$/);
  });

  it("AC7: it reads the farm's address, then Terms, Privacy and Contact", async () => {
    expect(textsOf((await render()).html)).toEqual([ADDRESS, "Terms", "Privacy", "Contact"]);
  });

  it("AC7: the address line is brand.address, the one home the signup email's footer reads too", async () => {
    expect(en["brand.address"]).toBe(ADDRESS);
    expect(textsOf((await render()).html)[0]).toBe(en["brand.address"]);
  });

  it("AC7: Terms goes to TERMS_PATH, Privacy to PRIVACY_PATH, and Contact to exactly mailto:<FARM_CONTACT_EMAIL>, no query", async () => {
    expect(attributesOf((await render()).html, "a").map((link) => link.href)).toEqual([TERMS_PATH, PRIVACY_PATH, `mailto:${CONTACT}`]);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("AC7: with FARM_CONTACT_EMAIL %s, Contact is left out, and Terms and Privacy stay", async (_what, value) => {
    vi.stubEnv("FARM_CONTACT_EMAIL", value);
    const { html } = await render();
    expect(textsOf(html)).toEqual([ADDRESS, "Terms", "Privacy"]);
    expect(attributesOf(html, "a").map((link) => link.href)).toEqual([TERMS_PATH, PRIVACY_PATH]);
    expect(html).not.toContain("mailto:");
  });

  it("AC7: Terms, Privacy and Contact are quiet buttons, and the address line is small, muted text", async () => {
    const { html } = await render();
    const links = attributesOf(html, "a");
    expect(links).toHaveLength(3);
    for (const link of links) expect(utilitiesOf(link.class)).toContain("btn-quiet");
    const addressClass = new RegExp(`<\\w+\\b[^>]*class="([^"]*)"[^>]*>\\s*${escapeRegExp(ADDRESS)}\\s*<`).exec(screenMarkup(html))?.[1];
    expect(utilitiesOf(addressClass)).toEqual(expect.arrayContaining(["text-small", "text-ink-muted"]));
  });
});
