// Issue 19, AC6: the one language switcher, `await LanguageSwitcher()` rendered through
// react-dom/server with `next/headers` faked. That the header calls it, and where, is
// app/site-header.test.ts's.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator, LANGUAGES } from "@core/i18n.js";
import { en } from "@core/messages/en.js";
import { Button } from "../components/ui/button";
import { setLanguage } from "./language-actions";
import { LanguageSwitcher } from "./language-switcher";
import { emptyRequest } from "./next-headers-fake";
import { attributesOf, findAll, textsOf } from "./screen-test-helpers";

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

const render = async (props?: Parameters<typeof LanguageSwitcher>[0]) => {
  const element = await LanguageSwitcher(props);
  return { element, html: renderToStaticMarkup(element) };
};

const NAMES = Object.values(LANGUAGES).map((language) => language.name);

describe("AC6 — LanguageSwitcher", () => {
  it("AC6: is a form holding one fieldset, holding one legend", async () => {
    const { element } = await render();
    const [form, ...otherForms] = findAll(element, "form");
    expect(otherForms).toEqual([]);
    const [fieldset, ...otherFieldsets] = findAll(form, "fieldset");
    expect(otherFieldsets).toEqual([]);
    expect(findAll(fieldset, "legend")).toHaveLength(1);
  });

  it("AC6: the legend reads language.label, then come the buttons, one per language, each named in itself", async () => {
    const { html } = await render();
    expect(textsOf(html)).toEqual([en["language.label"], ...NAMES]);
  });

  it("AC6: in Spanish the legend reads the Spanish label, and the buttons keep their own names", async () => {
    request.current.cookies = { lang: "es" };
    const { html } = await render();
    expect(textsOf(html)).toEqual([createTranslator("es")("language.label"), ...NAMES]);
  });

  it("AC6: the legend is visually hidden with sr-only", async () => {
    const { element } = await render();
    const legends = findAll(element, "legend");
    expect(legends).toHaveLength(1);
    expect(String(legends[0]?.props.className).split(/\s+/)).toContain("sr-only");
  });

  it("AC6: the form's action is setLanguage", async () => {
    const { element } = await render();
    expect(findAll(element, "form").map((form) => form.props.action)).toEqual([setLanguage]);
  });

  it('AC6: each button submits name="language" with its LANGUAGES code as value', async () => {
    const { element } = await render();
    const buttons = findAll(element, Button).map((b) => ({ name: b.props.name, value: b.props.value }));
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

// Issue 84: the header passes `flush` when the switch ends its row; only the last option meets the gutter.
describe("issue 84 — LanguageSwitcher's flush", () => {
  it.each(["end", "end-narrow"] as const)('with flush "%s" the last option alone carries it', async (flush) => {
    const { element } = await render({ flush });
    const flushes = findAll(element, Button).map((button) => button.props.flush);
    expect(flushes.at(-1)).toBe(flush);
    expect(flushes.slice(0, -1)).toEqual(flushes.slice(0, -1).map(() => undefined));
  });

  it("without flush no option carries one", async () => {
    const { element } = await render();
    expect(findAll(element, Button).map((button) => button.props.flush)).toEqual(Object.keys(LANGUAGES).map(() => undefined));
  });
});
