// Issue 19, AC1–AC3: app/globals.css's @theme against design/design-system/tokens.json, both ways,
// and Tailwind's own compiler run over app/globals.css to see which utilities exist.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { escapeRegExp } from "./screen-test-helpers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GLOBALS = join(ROOT, "app", "globals.css");
const TAILWIND = join(ROOT, "node_modules", "tailwindcss");

type Token = { name: string; value: string; usage?: string };
type TypeStyle = {
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
  usage?: string;
};
type Tokens = {
  color: { tokens: Token[] };
  type: { families: Record<string, string>; groups: Array<{ name: string; family: string; styles: TypeStyle[] }> };
  spacing: { tokens: Token[] };
  radius: { tokens: Token[] };
  shadow: { tokens: Token[] };
  size?: { tokens: Token[] };
};

const tokens = (): Tokens => JSON.parse(readFileSync(join(ROOT, "design", "design-system", "tokens.json"), "utf8")) as Tokens;
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const normal = (value: string): string => value.replace(/\s+/g, " ").trim();

// The next/font variable each family leads with (app/fonts.ts).
const FONT_VARIABLE: Record<string, string> = { sans: "--font-montserrat", display: "--font-oswald" };
// The size group's widths are containers (max-w-card); the rest are heights (h-field).
const CONTAINER_SIZES = new Set(["card", "page"]);

/** Every theme variable tokens.json implies, by namespace, aliases resolved to `var(--color-x)`. */
function expectedTheme(): Record<string, Map<string, string>> {
  const t = tokens();
  const color = new Map(
    t.color.tokens.map(({ name, value }) => {
      const alias = /^\{([\w-]+)\}$/.exec(value);
      return [`--color-${name}`, alias ? `var(--color-${alias[1]})` : value] as const;
    }),
  );
  const radius = new Map(t.radius.tokens.map(({ name, value }) => [`--${name}`, value] as const));
  const shadow = new Map(t.shadow.tokens.map(({ name, value }) => [`--${name}`, value] as const));
  const text = new Map<string, string>();
  for (const group of t.type.groups) {
    for (const style of group.styles) {
      text.set(`--text-${style.name}`, style.fontSize);
      text.set(`--text-${style.name}--line-height`, style.lineHeight);
      text.set(`--text-${style.name}--font-weight`, String(style.fontWeight));
      if (style.letterSpacing !== undefined) text.set(`--text-${style.name}--letter-spacing`, style.letterSpacing);
    }
  }
  const font = new Map(
    Object.entries(t.type.families).map(
      ([family, stack]) => [`--font-${family}`, `var(${FONT_VARIABLE[family] ?? "?"}), ${stack}`] as const,
    ),
  );
  const sizes = t.size?.tokens ?? [];
  const spacing = new Map(sizes.filter((s) => !CONTAINER_SIZES.has(s.name)).map((s) => [`--spacing-${s.name}`, s.value] as const));
  const container = new Map(sizes.filter((s) => CONTAINER_SIZES.has(s.name)).map((s) => [`--container-${s.name}`, s.value] as const));
  return { color, radius, shadow, text, font, spacing, container };
}

/** Which compared namespace a theme variable belongs to, or null for one AC1 does not compare. */
function namespaceOf(name: string): string | null {
  if (name.includes("*")) return null; // the `--x-*: initial` lines
  if (name.startsWith("--color-")) return "color";
  if (name.startsWith("--radius-")) return "radius";
  if (name.startsWith("--shadow-")) return "shadow";
  if (name.startsWith("--text-shadow-")) return null; // Tailwind's own namespace
  if (name.startsWith("--text-")) return "text";
  if (name.startsWith("--font-weight-")) return null; // Tailwind's own namespace, not cleared
  if (name.startsWith("--font-")) return "font";
  if (name.startsWith("--spacing-")) return "spacing"; // not `--spacing` itself
  if (name.startsWith("--container-")) return "container";
  return null;
}

/** The top-level declarations of every `@theme` block in app/globals.css, in order. */
function themeDeclarations(css: string): Array<[string, string]> {
  const source = withoutComments(css);
  const found: Array<[string, string]> = [];
  for (const match of source.matchAll(/@theme\b[^{;]*\{/g)) {
    let depth = 1;
    let quote: string | null = null;
    let current = "";
    for (let i = (match.index ?? 0) + match[0].length; i < source.length && depth > 0; i++) {
      const ch = source[i] as string;
      if (quote) {
        if (ch === quote && source[i - 1] !== "\\") quote = null;
        if (depth === 1) current += ch;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        if (depth === 1) current += ch;
      } else if (ch === "{") {
        depth++;
        current = "";
      } else if (ch === "}") {
        depth--;
        if (depth === 1) current = "";
        if (depth === 0) pushDeclaration(current, found);
      } else if (ch === ";" && depth === 1) {
        pushDeclaration(current, found);
        current = "";
      } else if (depth === 1) {
        current += ch;
      }
    }
  }
  return found;
}

function pushDeclaration(text: string, into: Array<[string, string]>): void {
  const colon = text.indexOf(":");
  if (colon === -1) return;
  const name = text.slice(0, colon).trim();
  if (!name.startsWith("--")) return;
  into.push([name, normal(text.slice(colon + 1))]);
}

/** The compared theme variables in app/globals.css, by namespace; a later declaration wins. */
function actualTheme(): Record<string, Map<string, string>> {
  const byNamespace: Record<string, Map<string, string>> = {};
  for (const [name, value] of themeDeclarations(readFileSync(GLOBALS, "utf8"))) {
    const ns = namespaceOf(name);
    if (ns === null) continue;
    (byNamespace[ns] ??= new Map()).set(name, value);
  }
  return byNamespace;
}

const NAMESPACES = ["color", "radius", "shadow", "text", "font", "spacing", "container"] as const;

describe("AC1 — app/globals.css's @theme matches tokens.json both ways", () => {
  it.each(NAMESPACES)("AC1: every %s token is a theme variable with the same value", (ns) => {
    const expected = expectedTheme()[ns] ?? new Map<string, string>();
    expect([...expected.keys()], `tokens.json yields no ${ns} theme variables`).not.toHaveLength(0);
    const actual = actualTheme()[ns] ?? new Map<string, string>();
    const got = Object.fromEntries([...expected.keys()].map((name) => [name, actual.get(name)]));
    expect(got).toEqual(Object.fromEntries([...expected].map(([name, value]) => [name, normal(value)])));
  });

  it.each(NAMESPACES)("AC1: every %s theme variable is a token", (ns) => {
    const expected = expectedTheme()[ns] ?? new Map<string, string>();
    const actual = actualTheme()[ns] ?? new Map<string, string>();
    expect([...actual.keys()].filter((name) => !expected.has(name))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// AC2: Tailwind's compiler over app/globals.css. A fresh compile per build, since `build` accumulates.

async function loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }> {
  let path: string;
  if (id === "tailwindcss") path = join(TAILWIND, "index.css");
  else if (id.startsWith("tailwindcss/")) {
    const sub = id.slice("tailwindcss/".length);
    path = join(TAILWIND, sub.endsWith(".css") ? sub : `${sub}.css`);
  } else path = resolve(base, id);
  return { path, base: dirname(path), content: readFileSync(path, "utf8") };
}

async function build(candidate: string): Promise<string> {
  const compiler = await compile(readFileSync(GLOBALS, "utf8"), {
    base: dirname(GLOBALS),
    loadStylesheet,
    loadModule: async (id: string) => {
      throw new Error(`app/globals.css loads a module (${id}); this test resolves stylesheets only`);
    },
  });
  return compiler.build([candidate]);
}

/** The declarations of the rule for `.<cls>` in compiled CSS, or undefined if there is none. */
const ruleFor = (css: string, cls: string): string | undefined =>
  new RegExp(`\\.${escapeRegExp(cls)}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
const declarationsOf = (css: string, cls: string): string => {
  const rule = ruleFor(css, cls);
  expect(rule, `no CSS for .${cls}`).toBeDefined();
  return rule ?? "";
};

describe("AC2 — Tailwind's defaults are cleared in the token namespaces; spacing is not", () => {
  it.each([
    ["bg-red-500", "bg-surface"],
    ["text-2xl", "text-body"],
    ["shadow-md", "shadow-card"],
    ["font-mono", "font-display"],
    ["max-w-md", "max-w-card"],
  ])("AC2: %s produces no CSS, while the token utility %s does", async (gone, kept) => {
    expect(ruleFor(await build(gone), gone)).toBeUndefined();
    expect(ruleFor(await build(kept), kept)).toBeDefined();
  });

  it("AC2: rounded-md resolves to var(--radius-md), 8px — not Tailwind's 6px", async () => {
    const css = await build("rounded-md");
    expect(declarationsOf(css, "rounded-md")).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(css).toMatch(/--radius-md:\s*8px/);
    expect(css).not.toMatch(/--radius-md:\s*0\.375rem/);
  });

  it("AC2: --spacing is 4px, so p-4 is still generated from it", async () => {
    const css = await build("p-4");
    expect(declarationsOf(css, "p-4")).toMatch(/var\(--spacing\)/);
    expect(css).toMatch(/--spacing:\s*4px\s*;/);
  });

  it("AC2: every space-N token in tokens.json equals N × 4px", () => {
    const spacing = tokens().spacing.tokens;
    expect(spacing).not.toHaveLength(0);
    for (const { name, value } of spacing) {
      const n = /^space-(\d+)$/.exec(name)?.[1];
      expect(n, `${name} is not space-N`).toBeDefined();
      expect(value, name).toBe(`${Number(n) * 4}px`);
    }
  });
});

// ---------------------------------------------------------------------------------------------

function typeStyle(name: string): { family: string; style: TypeStyle } | undefined {
  for (const group of tokens().type.groups) {
    const style = group.styles.find((s) => s.name === name);
    if (style) return { family: group.family, style };
  }
  return undefined;
}

describe("AC3 — tokens.json gains what the approved frame draws", () => {
  it("AC3: colour danger-soft is #fbeeec", () => {
    expect(tokens().color.tokens.find((t) => t.name === "danger-soft")?.value).toBe("#fbeeec");
  });

  it.each([
    ["field-label", "sans", "14px", "20px", 500, undefined],
    ["wordmark", "display", "22px", "26px", 400, "0.12em"],
    ["code", "sans", "28px", "32px", 500, "0.4em"],
  ] as const)(
    "AC3: type style %s sits in a %s group at %s / %s / %s, letter-spacing %s",
    (name, family, fontSize, lineHeight, fontWeight, letterSpacing) => {
      const found = typeStyle(name);
      expect(found, `no type style ${name}`).toBeDefined();
      expect(found?.family).toBe(family);
      expect(found?.style).toMatchObject({ fontSize, lineHeight, fontWeight });
      expect(found?.style.letterSpacing).toBe(letterSpacing);
    },
  );

  it("AC3: label's usage is narrowed to nav items", () => {
    const usage = typeStyle("label")?.style.usage ?? "";
    expect(usage).toMatch(/\bnav\b/i);
    expect(usage).not.toMatch(/field/i);
  });

  it("AC3: a size group holds field 48px, button 52px, code-field 60px, touch 44px, card 440px, page 1120px, shaped as spacing is", () => {
    const size = tokens().size?.tokens ?? [];
    expect(Object.fromEntries(size.map(({ name, value }) => [name, value]))).toEqual({
      field: "48px",
      button: "52px",
      "code-field": "60px",
      touch: "44px",
      card: "440px",
      page: "1120px",
    });
    for (const token of size) expect(typeof token.usage, `${token.name} has no usage`).toBe("string");
  });
});
