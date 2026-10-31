// Issue 19, AC6: the one language switcher, `await LanguageSwitcher()` rendered through
// react-dom/server with `next/headers` faked, and the two places that call it inline.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LANGUAGES } from "@core/i18n.js";
import { setLanguage } from "./language-actions";
import { LanguageSwitcher } from "./language-switcher";
import { emptyRequest } from "./next-headers-fake";
import { attributesOf, findAll, screenMarkup } from "./screen-test-helpers";

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

const render = async () => {
  const element = await LanguageSwitcher();
  return { element, html: renderToStaticMarkup(element) };
};

const classesOf = (attributes: Record<string, string> | undefined): string[] =>
  (attributes?.class ?? "").split(/\s+/).filter(Boolean);

describe("AC6 — LanguageSwitcher", () => {
  it("AC6: is a form holding one fieldset: a legend reading language.label, then one button per language, named in itself", async () => {
    const { html } = await render();
    expect(screenMarkup(html).trim()).toMatch(
      new RegExp(
        "^<form\\b[^>]*>\\s*<fieldset\\b[^>]*>\\s*<legend\\b[^>]*>Language</legend>\\s*" +
          "<button\\b[^>]*>English</button>\\s*<button\\b[^>]*>Español</button>\\s*</fieldset>\\s*</form>$",
      ),
    );
  });

  it("AC6: in Spanish the legend reads Idioma, and the buttons keep their own names", async () => {
    request.current.cookies = { lang: "es" };
    const { html } = await render();
    expect(screenMarkup(html)).toMatch(
      /<legend\b[^>]*>Idioma<\/legend>\s*<button\b[^>]*>English<\/button>\s*<button\b[^>]*>Español<\/button>/,
    );
  });

  it("AC6: the legend is visually hidden with sr-only", async () => {
    const { html } = await render();
    const legends = attributesOf(html, "legend");
    expect(legends).toHaveLength(1);
    expect(classesOf(legends[0])).toContain("sr-only");
  });

  it("AC6: the form's action is setLanguage", async () => {
    const { element } = await render();
    const forms = findAll(element, "form");
    expect(forms).toHaveLength(1);
    expect(forms[0]?.props.action).toBe(setLanguage);
  });

  it('AC6: each button submits name="language" with its LANGUAGES code as value', async () => {
    const { element } = await render();
    const buttons = findAll(element, "button").map((b) => ({ name: b.props.name, value: b.props.value }));
    expect(buttons).toEqual(Object.keys(LANGUAGES).map((code) => ({ name: "language", value: code })));
  });

  it.each([
    ["en", {}],
    ["es", { lang: "es" }],
  ] as const)('AC6: with the language %s, its button alone carries aria-current="true"', async (current, cookies) => {
    request.current.cookies = { ...cookies };
    const { html } = await render();
    const buttons = attributesOf(html, "button");
    expect(buttons.map((b) => b.value)).toEqual(Object.keys(LANGUAGES));
    for (const button of buttons) {
      if (button.value === current) expect(button["aria-current"], button.value).toBe("true");
      else expect(button, button.value).not.toHaveProperty("aria-current");
    }
  });
});

// The home page and the sign-in header must call this component, not carry their own copy: with
// the module mocked to a marker, the marker is what they render where the switcher goes.
describe("AC6 — the home page and the sign-in header both use LanguageSwitcher", () => {
  const marker = () => createElement("div", { id: "switcher-marker" });

  afterEach(() => {
    vi.doUnmock("./language-switcher");
    vi.resetModules();
  });

  async function withMockedSwitcher<T>(load: () => Promise<T>): Promise<T> {
    vi.resetModules();
    vi.doMock("./language-switcher", () => ({ LanguageSwitcher: async () => marker() }));
    return load();
  }

  it("AC6: the home page renders LanguageSwitcher and no switcher of its own", async () => {
    const { default: Home } = await withMockedSwitcher(() => import("./page"));
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('<div id="switcher-marker"></div>');
    expect(html).not.toMatch(/<fieldset\b|<legend\b/);
  });

  it("AC6: the sign-in header renders LanguageSwitcher and no switcher of its own", async () => {
    const { default: SignInLayout } = await withMockedSwitcher(() => import("./sign-in/layout"));
    const html = renderToStaticMarkup(await SignInLayout({ children: createElement("main", null) }));
    expect(html).toMatch(/<header\b[^>]*>[\s\S]*<div id="switcher-marker"><\/div>[\s\S]*<\/header>/);
    expect(html).not.toMatch(/<fieldset\b|<legend\b/);
  });
});
