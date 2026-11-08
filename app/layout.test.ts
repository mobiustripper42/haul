// AC13: `await RootLayout({ children })` rendered through react-dom/server with `next/headers` faked.
// Issue 97, AC7: the root layout ends every page with the footer. SiteFooter's own markup is the footer's
// tests'; here it is faked, so what is read is the one thing the layout decides: where it goes.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RootLayout from "./layout";
import { emptyRequest } from "./next-headers-fake";
import { textsOf } from "./screen-test-helpers";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
// Issue 19: `localFont` throws when called outside Next's compiler, so the layout's fonts are mocked.
vi.mock("./fonts", () => ({ fontVariables: "font-variables" }));
vi.mock("./site-footer", () => ({ SiteFooter: async () => createElement("footer", null, "the footer") }));

beforeEach(() => {
  request.current = emptyRequest();
});

const htmlTag = async (): Promise<string> => {
  const markup = renderToStaticMarkup(await RootLayout({ children: null }));
  const tag = markup.match(/<html\b[^>]*>/)?.[0];
  if (!tag) throw new Error(`no <html> element in: ${markup}`);
  return tag;
};

describe("AC13 — <html lang> follows the resolved language", () => {
  it('AC13: renders <html lang="es"> when the lang cookie is es', async () => {
    request.current.cookies = { lang: "es" };
    expect(await htmlTag()).toMatch(/\slang="es"/);
  });

  it('AC13: renders <html lang="es"> when Accept-Language resolves to Spanish', async () => {
    request.current.headers = { "accept-language": "es-MX" };
    expect(await htmlTag()).toMatch(/\slang="es"/);
  });

  it('AC13: renders <html lang="en"> with no cookie and no Accept-Language', async () => {
    expect(await htmlTag()).toMatch(/\slang="en"/);
  });

  it('AC13: renders <html lang="en"> when the lang cookie is en, over an Accept-Language of es', async () => {
    request.current.cookies = { lang: "en" };
    request.current.headers = { "accept-language": "es" };
    expect(await htmlTag()).toMatch(/\slang="en"/);
  });
});

describe("AC7 (issue 97) — every page ends with the footer", () => {
  it("AC7: <body> holds the page, then the footer, and nothing after it", async () => {
    const markup = renderToStaticMarkup(await RootLayout({ children: createElement("p", null, "child") }));
    const body = /<body\b[^>]*>([\s\S]*)<\/body>/.exec(markup)?.[1];
    if (body === undefined) throw new Error(`no <body> element in: ${markup}`);
    expect(textsOf(body)).toEqual(["child", "the footer"]);
  });
});
