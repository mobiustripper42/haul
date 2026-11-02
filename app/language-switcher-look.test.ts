// Issue 38, AC11: the language switcher's buttons are `Button kind="quiet"` carrying only btn-quiet,
// and app/globals.css draws the current language from aria-current. The CSS is read through
// Tailwind's own compiler, as app/theme.test.ts reads it: each rule must compile to what
// `@apply font-semibold` and `@apply text-teal-muted` compile to.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "../components/ui/button";
import { LanguageSwitcher } from "./language-switcher";
import { emptyRequest } from "./next-headers-fake";
import { attributesOf, findAll } from "./screen-test-helpers";

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

describe("AC11 — the switcher's buttons are quiet Buttons, and nothing sits beside the kind", () => {
  it.each([
    ["en", {}],
    ["es", { lang: "es" }],
  ] as const)('AC11: with the language %s, each option is a <Button kind="quiet"> with no full, flush, back or href', async (_current, cookies) => {
    request.current.cookies = { ...cookies };
    const buttons = findAll(await LanguageSwitcher(), Button);
    expect(buttons).toHaveLength(2);
    for (const { props } of buttons) {
      expect(props.kind).toBe("quiet");
      for (const extra of ["full", "flush", "back", "href", "className"]) expect(props[extra], extra).toBeUndefined();
    }
  });

  it.each([
    ["en", {}],
    ["es", { lang: "es" }],
  ] as const)("AC11: with the language %s, each rendered option's class is btn-quiet alone", async (_current, cookies) => {
    request.current.cookies = { ...cookies };
    const buttons = attributesOf(renderToStaticMarkup(await LanguageSwitcher()), "button");
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.class)).toEqual(["btn-quiet", "btn-quiet"]);
  });
});

// ---------------------------------------------------------------------------------------------

const GLOBALS = fileURLToPath(new URL("./globals.css", import.meta.url));
const TAILWIND = fileURLToPath(new URL("../node_modules/tailwindcss", import.meta.url));

async function loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }> {
  let path: string;
  if (id === "tailwindcss") path = join(TAILWIND, "index.css");
  else if (id.startsWith("tailwindcss/")) {
    const sub = id.slice("tailwindcss/".length);
    path = join(TAILWIND, sub.endsWith(".css") ? sub : `${sub}.css`);
  } else path = resolve(base, id);
  return { path, base: dirname(path), content: readFileSync(path, "utf8") };
}

/** app/globals.css, with two probe rules appended, compiled with no candidates. */
async function compiled(): Promise<string> {
  const source = `${readFileSync(GLOBALS, "utf8")}\n.probe-current { @apply font-semibold; }\n.probe-other { @apply text-teal-muted; }\n`;
  const compiler = await compile(source, {
    base: dirname(GLOBALS),
    loadStylesheet,
    loadModule: async (id: string) => {
      throw new Error(`app/globals.css loads a module (${id}); this test resolves stylesheets only`);
    },
  });
  return compiler.build([]);
}

const selector = (s: string): string => s.replace(/\s+/g, " ").replace(/\s*>\s*/g, " > ").replace(/'/g, '"').trim();
const declarations = (body: string): string[] =>
  body
    .split(";")
    .map((d) => d.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort();

/** The declarations of every innermost rule whose selector is `wanted`, merged. */
function rulesFor(css: string, wanted: string): string[] | undefined {
  const found = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    (m) => selector(m[1] ?? "") === selector(wanted),
  );
  return found.length === 0 ? undefined : found.flatMap((m) => declarations(m[2] ?? "")).sort();
}

describe("AC11 — app/globals.css draws the current language from aria-current", () => {
  it.each([
    ['.lang-switch > button[aria-current="true"]', "font-semibold", ".probe-current"],
    ['.lang-switch > button:not([aria-current="true"])', "text-teal-muted", ".probe-other"],
  ])("AC11: %s compiles to what @apply %s gives", async (rule, _utility, probe) => {
    const css = await compiled();
    const expected = rulesFor(css, probe);
    expect(expected, `the probe ${probe} compiled to nothing`).toBeDefined();
    expect(rulesFor(css, rule), `no rule for ${rule} in app/globals.css`).toEqual(expected);
  });
});
