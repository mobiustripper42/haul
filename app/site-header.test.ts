// Issue 55, AC17 and AC18: the header moved out of app/sign-in/layout.tsx. `await SiteHeader(props)`
// rendered through react-dom/server with `next/headers` faked, as app/sign-in/layout.test.ts renders it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "./next-headers-fake";
import { attributesOf, normalMarkup, screenMarkup, textsOf, utilitiesOf } from "./screen-test-helpers";
import { SiteHeader } from "./site-header";
import SignInLayout from "./sign-in/layout";

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

beforeEach(() => {
  request.current = emptyRequest();
});

const BRAND_AND_SWITCH = ["Ohio City Farm", "by Re:Source Cleveland", "Language", "English", "Español"];
const render = async (account: "none" | "sign-in" | "your-account") => renderToStaticMarkup(await SiteHeader({ account }));

describe("AC18 — SiteHeader, account none, is the header the sign-in screens had", () => {
  it("AC18: it renders one <header> holding the brand link to / and the language switch, and no other link", async () => {
    const html = await render("none");
    expect(screenMarkup(html)).toMatch(/^<header\b/);
    expect(textsOf(html)).toEqual(BRAND_AND_SWITCH);
    expect(attributesOf(html, "a").map((link) => link.href)).toEqual(["/"]);
  });

  it("AC18: the sign-in layout is that header, then its children", async () => {
    const child = createElement("p", null, "child");
    const header = await render("none");
    expect(textsOf(header), "SiteHeader renders nothing yet").toEqual(BRAND_AND_SWITCH);
    const layout = renderToStaticMarkup(await SignInLayout({ children: child }));
    expect(normalMarkup(layout)).toBe(normalMarkup(`${header}<p>child</p>`));
  });
});

describe("AC17 — SiteHeader's account link", () => {
  it('AC17: account "sign-in" adds a secondary "Sign in" link to /sign-in after the language switch', async () => {
    const html = await render("sign-in");
    expect(textsOf(html)).toEqual([...BRAND_AND_SWITCH, "Sign in"]);
    const [, link] = attributesOf(html, "a");
    expect(link?.href).toBe("/sign-in");
    expect(utilitiesOf(link?.class)).toContain("btn-secondary");
  });

  it('AC17: account "your-account" adds a link "Your account" to / after the language switch, and no "Sign in"', async () => {
    const html = await render("your-account");
    expect(textsOf(html)).toEqual([...BRAND_AND_SWITCH, "Your account"]);
    expect(attributesOf(html, "a").map((link) => link.href)).toEqual(["/", "/"]);
  });
});
