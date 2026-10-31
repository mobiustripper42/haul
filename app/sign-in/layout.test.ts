// Issue 19, AC5: the sign-in screens' header, `await SignInLayout({ children })` rendered through
// react-dom/server with `next/headers` faked, as app/layout.test.ts renders the root layout.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../language-actions";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, findAll, screenMarkup, textsOf } from "../screen-test-helpers";
import SignInLayout from "./layout";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));

beforeEach(() => {
  request.current = emptyRequest();
});

const CHILD = "the page itself";

async function render() {
  const element = await SignInLayout({ children: createElement("main", null, createElement("p", null, CHILD)) });
  const html = renderToStaticMarkup(element);
  return { element, html, markup: screenMarkup(html) };
}

/** The markup inside the one <header>, or throws. */
function headerOf(markup: string): string {
  const headers = [...markup.matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/g)];
  expect(headers, "expected exactly one <header>").toHaveLength(1);
  return headers[0]?.[1] ?? "";
}

describe("AC5 — both sign-in screens open with the header", () => {
  it("AC5: renders a <header>, then children", async () => {
    const { markup } = await render();
    const header = headerOf(markup);
    expect(header).not.toContain(CHILD);
    expect(markup).toMatch(new RegExp(`</header>[\\s\\S]*<main>\\s*<p>${CHILD}</p>\\s*</main>`));
    expect(markup.indexOf("<header")).toBeLessThan(markup.indexOf(CHILD));
  });

  it('AC5: the header holds one link, to /, holding "Ohio City Farm" and under it "by Re:Source Cleveland"', async () => {
    const { markup } = await render();
    const header = headerOf(markup);
    expect(attributesOf(header, "a")).toEqual([expect.objectContaining({ href: "/" })]);
    const link = /<a\b[^>]*>([\s\S]*?)<\/a>/.exec(header)?.[1] ?? "";
    expect(textsOf(link)).toEqual(["Ohio City Farm", "by Re:Source Cleveland"]);
  });

  it("AC5: after the link the header holds the language switcher, and the screen's words run brand, switcher, page", async () => {
    const { markup } = await render();
    expect(headerOf(markup)).toMatch(
      /<a\b[^>]*>[\s\S]*<\/a>[\s\S]*<form\b[^>]*>\s*<fieldset\b[^>]*>\s*<legend\b[^>]*>Language<\/legend>[\s\S]*<\/fieldset>\s*<\/form>/,
    );
    expect(textsOf(markup)).toEqual(["Ohio City Farm", "by Re:Source Cleveland", "Language", "English", "Español", CHILD]);
  });

  it("AC5: the switcher in the header is wired to setLanguage", async () => {
    const { element } = await render();
    const forms = findAll(element, "form");
    expect(forms).toHaveLength(1);
    expect(forms[0]?.props.action).toBe(setLanguage);
  });
});
