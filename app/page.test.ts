// AC11, AC12 and AC14's wiring: `await Home()` rendered through react-dom/server with
// `next/headers` faked (no DOM library is installed), asserting on the markup.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "./language-actions";
import { emptyRequest } from "./next-headers-fake";
import Home from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});

beforeEach(() => {
  request.current = emptyRequest();
});

const renderHome = async (): Promise<string> => renderToStaticMarkup(await Home());

// `form > fieldset > (legend, button, button)`, nothing else inside the fieldset.
const switcher = (legend: string): RegExp =>
  new RegExp(
    `<form\\b[^>]*>\\s*<fieldset\\b[^>]*>\\s*<legend\\b[^>]*>${legend}</legend>\\s*` +
      `<button\\b[^>]*>English</button>\\s*<button\\b[^>]*>Español</button>\\s*</fieldset>\\s*</form>`,
  );

function expectSpanish(html: string): void {
  expect(html).toMatch(/<h1\b[^>]*>Portal de miembros de OCF<\/h1>/);
  expect(html).toMatch(/<p\b[^>]*>Comprobación del núcleo: \$12\.34<\/p>/);
  expect(html).toMatch(switcher("Idioma"));
  expect(html).not.toContain("OCF Member Portal");
  expect(html).not.toContain("Core check");
}

describe("AC11 — the page in Spanish", () => {
  it('AC11: with the lang cookie set to "es", shows the Spanish heading, paragraph and fieldset', async () => {
    request.current.cookies = { lang: "es" };
    expectSpanish(await renderHome());
  });
});

describe("AC12 — the page in English", () => {
  it("AC12: with no cookie and no Accept-Language, shows the English heading, paragraph and fieldset", async () => {
    const html = await renderHome();
    expect(html).toMatch(/<h1\b[^>]*>OCF Member Portal<\/h1>/);
    expect(html).toMatch(/<p\b[^>]*>Core check: \$12\.34<\/p>/);
    expect(html).toMatch(switcher("Language"));
    expect(html).not.toContain("Portal de miembros");
  });

  it("AC12: with no cookie and Accept-Language es-MX, renders as in AC11", async () => {
    request.current.headers = { "accept-language": "es-MX" };
    expectSpanish(await renderHome());
  });
});

// The element tree `Home` returns: the form sits directly in it (no components exist).
function findAll(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child as ReactNode, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  const here = node.type === type ? [node] : [];
  return [...here, ...findAll(node.props.children as ReactNode, type)];
}

describe("AC14 — the switcher is wired to setLanguage", () => {
  it("AC14: the page's form has setLanguage as its action", async () => {
    const forms = findAll(await Home(), "form");
    expect(forms).toHaveLength(1);
    expect(forms[0]?.props.action).toBe(setLanguage);
  });

  it('AC14: each button submits name="language" with its language code', async () => {
    const [form] = findAll(await Home(), "form");
    const buttons = findAll(form?.props.children as ReactNode, "button").map((b) => ({
      name: b.props.name,
      value: b.props.value,
    }));
    expect(buttons).toEqual([
      { name: "language", value: "en" },
      { name: "language", value: "es" },
    ]);
  });
});
