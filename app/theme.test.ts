// Issue 19, AC1–AC3 and AC19: app/globals.css's @theme against design/design-system/tokens.json,
// both ways, and Tailwind's own compiler run over app/globals.css to see which utilities exist and
// what the shipped stylesheet carries.
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile as compileForBuild } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
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

/**
 * AC1 (2026-10-31): a type style's size and line height, and every size length, is written in the
 * theme in rem (the token's px ÷ 16) so AC19's desktop root scales it; radius, shadow, letter spacing
 * and weight are compared as written.
 */
function isRemLength(name: string): boolean {
  if (name.startsWith("--spacing-") || name.startsWith("--container-")) return true;
  if (!name.startsWith("--text-")) return false;
  return !name.slice(2).includes("--") || name.endsWith("--line-height");
}

/** A rem length as the px it is at the 16px root; anything else is reported as written, not rem. */
function remAsPx(value: string): string {
  const rem = /^(\d*\.?\d+)rem$/.exec(value);
  return rem ? `${Number(rem[1]) * 16}px` : `${value} (not rem)`;
}

/** The compared theme variables in app/globals.css, by namespace; a later declaration wins. */
function actualTheme(): Record<string, Map<string, string>> {
  const byNamespace: Record<string, Map<string, string>> = {};
  for (const [name, value] of themeDeclarations(readFileSync(GLOBALS, "utf8"))) {
    const ns = namespaceOf(name);
    if (ns === null) continue;
    (byNamespace[ns] ??= new Map()).set(name, isRemLength(name) ? remAsPx(value) : value);
  }
  return byNamespace;
}

const NAMESPACES = ["color", "radius", "shadow", "text", "font", "spacing", "container"] as const;

describe("AC1 — app/globals.css's @theme matches tokens.json both ways", () => {
  it.each(NAMESPACES)("AC1: every %s token is a theme variable with the same value, lengths in rem read as px", (ns) => {
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

  it("AC2: --spacing is 0.25rem (4px at the 16px root), so p-4 is still generated from it", async () => {
    const css = await build("p-4");
    expect(declarationsOf(css, "p-4")).toMatch(/var\(--spacing\)/);
    expect([...css.matchAll(/--spacing:\s*([^;]*);/g)].map((m) => (m[1] as string).trim())).toEqual(["0.25rem"]);
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
// AC2, review fix: the shipped stylesheet. @tailwindcss/postcss compiles app/globals.css with
// @tailwindcss/node, then scans for candidates with oxide's Scanner over the compiler's root and
// @source entries; a null root is the whole project from the cwd, which is the repo root under Next.

async function shippedBuild(): Promise<{ files: string[]; css: string }> {
  const compiler = await compileForBuild(readFileSync(GLOBALS, "utf8"), {
    base: dirname(GLOBALS),
    from: GLOBALS,
    onDependency: () => {},
  });
  const root =
    compiler.root === "none" ? [] : compiler.root === null ? [{ base: ROOT, pattern: "**/*", negated: false }] : [{ ...compiler.root, negated: false }];
  const scanner = new Scanner({ sources: [...root, ...compiler.sources] });
  const candidates = scanner.scan();
  return { files: scanner.files.map((file) => relative(ROOT, file)), css: compiler.build(candidates) };
}

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

describe("AC2 — the shipped CSS builds no utility from a test file, design/ or docs/", () => {
  it("AC2: Tailwind's scan of the repo reads no test file and nothing under design/ or docs/", async () => {
    const { files } = await shippedBuild();
    expect(files.length, "the scan read no files at all").toBeGreaterThan(0);
    expect(files.filter((file) => TEST_FILE.test(file) || /^(design|docs)\//.test(file)).sort()).toEqual([]);
  });

  it("AC2: the shipped CSS has no .text-gold rule and no arbitrary -[ utility", async () => {
    const { css } = await shippedBuild();
    const selectors = [...css.matchAll(/(^|[\s,}])(\.[^\s{,]+)/g)].map((m) => m[2] as string);
    expect(selectors.filter((s) => /(^\.|\\:|\\!)text-gold(?![\w-])/.test(s) || s.includes("-\\["))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// AC19: the shipped stylesheet's root font size. A small CSS walker: every style rule with the
// at-rules and rules around it, so a declaration can be placed inside or outside a media query.

type Block = { prelude: string; declarations: string[]; children: Block[] };

function parseCss(css: string): Block {
  const root: Block = { prelude: "", declarations: [], children: [] };
  const stack: Block[] = [root];
  let buffer = "";
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i] as string;
    if (quote) {
      buffer += ch;
      if (ch === quote && css[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    const top = stack[stack.length - 1] as Block;
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
    } else if (ch === "{") {
      const block: Block = { prelude: normal(buffer), declarations: [], children: [] };
      top.children.push(block);
      stack.push(block);
      buffer = "";
    } else if (ch === "}") {
      if (buffer.trim()) top.declarations.push(normal(buffer));
      buffer = "";
      if (stack.length > 1) stack.pop();
    } else if (ch === ";") {
      if (buffer.trim()) top.declarations.push(normal(buffer));
      buffer = "";
    } else {
      buffer += ch;
    }
  }
  return root;
}

/** Every `font-size` set on `html` or `:root`, with the media queries around it, whitespace removed. */
function rootFontSizes(css: string): Array<{ media: string[]; value: string }> {
  const found: Array<{ media: string[]; value: string }> = [];
  const walk = (block: Block, around: string[]): void => {
    for (const child of block.children) {
      const isRule = !child.prelude.startsWith("@");
      const selectors = isRule ? child.prelude.split(",").map((s) => s.trim()) : [];
      if (selectors.includes("html") || selectors.includes(":root")) {
        for (const declaration of child.declarations) {
          const colon = declaration.indexOf(":");
          if (colon !== -1 && declaration.slice(0, colon).trim().toLowerCase() === "font-size") {
            found.push({
              media: around.filter((p) => p.startsWith("@media")).map((p) => p.replace(/\s+/g, "")),
              value: declaration.slice(colon + 1).trim(),
            });
          }
        }
      }
      walk(child, [...around, child.prelude]);
    }
  };
  walk(parseCss(css), []);
  return found;
}

const DESKTOP_WITH_A_MOUSE = "@media(min-width:1024px)and(pointer:fine)";

describe("AC19 — desktop with a mouse sets the root one step smaller; phones and tablets keep 100%", () => {
  it("AC19: the shipped CSS sets html { font-size: 93.75% } inside @media (min-width: 1024px) and (pointer: fine)", async () => {
    const { css } = await shippedBuild();
    expect(rootFontSizes(css)).toContainEqual({ media: [DESKTOP_WITH_A_MOUSE], value: "93.75%" });
  });

  it("AC19: the shipped CSS sets the root font size nowhere else, so phones and tablets keep 100%", async () => {
    const { css } = await shippedBuild();
    expect(rootFontSizes(css).filter(({ media }) => media.length !== 1 || media[0] !== DESKTOP_WITH_A_MOUSE)).toEqual([]);
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

  // AC3's 85% scale (Eric, 2026-10-31): the existing styles' size and line height, and the one weight
  // AC3 gives. Their letter spacing is unchanged and AC1 holds it to the theme.
  it.each([
    ["display", "34px", "38px", undefined],
    ["heading", "24px", "30px", undefined],
    ["section", "17px", "22px", undefined],
    ["body", "14px", "22px", undefined],
    ["body-strong", "14px", "22px", 600],
    ["small", "12px", "18px", undefined],
    ["label", "11px", "16px", undefined],
    ["button", "14px", "20px", undefined],
  ] as const)("AC3: type style %s is scaled to %s / %s, weight %s where AC3 gives one", (name, fontSize, lineHeight, fontWeight) => {
    const found = typeStyle(name);
    expect(found, `no type style ${name}`).toBeDefined();
    expect(found?.style).toMatchObject({ fontSize, lineHeight });
    if (fontWeight !== undefined) expect(found?.style.fontWeight).toBe(fontWeight);
  });

  it.each([
    ["field-label", "sans", "12px", "18px", 500, undefined],
    ["wordmark", "display", "19px", "22px", 400, "0.12em"],
    ["byline", "sans", "11px", "14px", 400, undefined],
    ["code", "sans", "24px", "28px", 500, "0.4em"],
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

  it("AC3: a size group holds field 40px, button 44px, code-field 52px, touch 44px, card 376px, page 960px, shaped as spacing is", () => {
    const size = tokens().size?.tokens ?? [];
    expect(Object.fromEntries(size.map(({ name, value }) => [name, value]))).toEqual({
      field: "40px",
      button: "44px",
      "code-field": "52px",
      touch: "44px",
      card: "376px",
      page: "960px",
    });
    for (const token of size) expect(typeof token.usage, `${token.name} has no usage`).toBe("string");
  });
});
