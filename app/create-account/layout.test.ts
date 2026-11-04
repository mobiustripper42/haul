// Issue 55, AC18: Create Account's layout is SiteHeader with no account link, then the page.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "../next-headers-fake";
import { normalMarkup, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import CreateAccountLayout from "./layout";

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

describe('AC18 — the Create Account layout uses SiteHeader with account "none"', () => {
  it('AC18: it renders SiteHeader\'s "none" header, then its children', async () => {
    const element = await CreateAccountLayout({ children: createElement("p", null, "child") });
    const html = renderToStaticMarkup(element);
    expect(textsOf(html)).toContain("Ohio City Farm");
    expect(textsOf(html)).not.toContain("Sign in");
    const header = renderToStaticMarkup(await SiteHeader({ account: "none" }));
    expect(normalMarkup(html)).toBe(normalMarkup(`${header}<p>child</p>`));
  });
});
