// Issue 97, AC7: the footer every page ends with. `await SiteFooter()` read as the tree it returns, and as
// markup for the order of its words, with `next/headers` faked, as app/site-header.test.ts reads the header.
// FARM_CONTACT_EMAIL is set and unset in the environment, which is what `getFarmContactEmail()` reads.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVACY_PATH, TERMS_PATH } from "@core/legal-documents.js";
import { en } from "@core/messages/en.js";
import { Button } from "../components/ui/button";
import { SiteBar } from "../components/ui/site-bar";
import { emptyRequest } from "./next-headers-fake";
import { findAll, textsOf } from "./screen-test-helpers";
import { SiteFooter } from "./site-footer";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});

const CONTACT = "farm@ohiocityfarm.test";
const LINKS = [en["footer.terms"], en["footer.privacy"], en["footer.contact"]];

beforeEach(() => {
  request.current = emptyRequest();
  vi.stubEnv("FARM_CONTACT_EMAIL", CONTACT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const render = async () => {
  const element = await SiteFooter();
  return { element, words: textsOf(renderToStaticMarkup(element)), buttons: findAll(element, Button) };
};

describe("AC7 — the footer", () => {
  it("AC7: SiteFooter renders through SiteBar, as the footer", async () => {
    const { element } = await render();
    expect(findAll(element, SiteBar).map((bar) => bar.props.as)).toEqual(["footer"]);
  });

  it("AC7: it reads the farm's address, then Terms, Privacy and Contact", async () => {
    expect((await render()).words).toEqual([en["brand.address"], ...LINKS]);
  });

  it("AC7: the address is the one the criterion spells out", async () => {
    expect((await render()).words[0]).toBe("Ohio City Farm · 2304 Bridge Ave, Cleveland, OH");
  });

  it("AC7: Terms goes to TERMS_PATH, Privacy to PRIVACY_PATH, and Contact to exactly mailto:<FARM_CONTACT_EMAIL>, no query", async () => {
    expect((await render()).buttons.map((button) => button.props.href)).toEqual([TERMS_PATH, PRIVACY_PATH, `mailto:${CONTACT}`]);
  });

  it("AC7: Terms, Privacy and Contact are quiet links", async () => {
    expect((await render()).buttons.map((button) => button.props.kind)).toEqual(["quiet", "quiet", "quiet"]);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("AC7: with FARM_CONTACT_EMAIL %s, Contact is left out, and Terms and Privacy stay", async (_what, value) => {
    vi.stubEnv("FARM_CONTACT_EMAIL", value);
    const { words, buttons } = await render();
    expect(words).toEqual([en["brand.address"], en["footer.terms"], en["footer.privacy"]]);
    expect(buttons.map((button) => button.props.href)).toEqual([TERMS_PATH, PRIVACY_PATH]);
  });
});
