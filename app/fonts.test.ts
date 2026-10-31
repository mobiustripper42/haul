// Issue 19, AC4: the fonts load from files in app/fonts/ through next/font/local, never from Google.
// The src lists are read from app/fonts.ts's source, as muster/app/fonts.test.ts reads its layout's.
// `localFont` throws outside Next's compiler, so it is mocked here to hand back its `variable`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fontVariables } from "./fonts";
import RootLayout from "./layout";
import { emptyRequest } from "./next-headers-fake";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/font/local", () => ({
  default: (options: { variable?: string }) => ({
    className: `class${options.variable ?? ""}`,
    variable: `variable${options.variable ?? ""}`,
    style: { fontFamily: "mocked" },
  }),
}));

beforeEach(() => {
  request.current = emptyRequest();
});

const APP = fileURLToPath(new URL(".", import.meta.url));
const FONTS_TS = join(APP, "fonts.ts");

/** Block comments and whole-line `//` comments, so prose naming a file or an import is not read as code. */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every source file under `dir` matching `pattern`, tests excluded. */
function sources(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path, pattern));
    else if (pattern.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Each `localFont(...)` call in app/fonts.ts: its `variable`, and the path and weight of each src entry. */
function declaredFamilies(): Array<{ variable: string | undefined; src: Array<{ path: string; weight: string | undefined }> }> {
  const source = withoutComments(readFileSync(FONTS_TS, "utf8"));
  return source
    .split(/\blocalFont\s*\(/)
    .slice(1)
    .map((call) => ({
      variable: /\bvariable\s*:\s*["'](--font-[\w-]+)["']/.exec(call)?.[1],
      src: [...call.matchAll(/\{[^{}]*\bpath\s*:\s*["']([^"']+)["'][^{}]*\}/g)].map((entry) => ({
        path: entry[1] as string,
        weight: /\bweight\s*:\s*["'](\d{3})["']/.exec(entry[0])?.[1],
      })),
    }));
}

const declaredFiles = (): string[] =>
  declaredFamilies().flatMap((family) => family.src.map((s) => relative(APP, resolve(APP, s.path))));

describe("AC4 — fonts load from files in app/fonts/ through next/font/local", () => {
  it("AC4: app/fonts.ts imports next/font/local", () => {
    expect(withoutComments(readFileSync(FONTS_TS, "utf8"))).toMatch(/from\s+["']next\/font\/local["']/);
  });

  it("AC4: it loads Montserrat 400, 500, 600 as --font-montserrat and Oswald 400, 500 as --font-oswald", () => {
    const weights = Object.fromEntries(
      declaredFamilies().map((family) => [family.variable, family.src.map((s) => s.weight).sort()]),
    );
    expect(weights).toEqual({
      "--font-montserrat": ["400", "500", "600"],
      "--font-oswald": ["400", "500"],
    });
  });

  it("AC4: the files it lists are the five woff2 files in app/fonts/", () => {
    expect(declaredFiles().sort()).toEqual(
      [
        "fonts/montserrat-400.woff2",
        "fonts/montserrat-500.woff2",
        "fonts/montserrat-600.woff2",
        "fonts/oswald-400.woff2",
        "fonts/oswald-500.woff2",
      ].map((p) => join(p)),
    );
  });

  it("AC4: every file it lists exists and is a real WOFF2 font", () => {
    const files = declaredFiles();
    expect(files).not.toHaveLength(0);
    for (const file of files) {
      const path = join(APP, file);
      expect(existsSync(path), `${file} does not exist`).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 4).toString("latin1"), `${file} is not a WOFF2 file`).toBe("wOF2");
      expect(bytes.byteLength, `${file} is implausibly small`).toBeGreaterThan(5_000);
    }
  });

  it.each(["Montserrat", "Oswald"])("AC4: %s's OFL licence sits beside the fonts", (family) => {
    const path = join(APP, "fonts", `${family}-OFL.txt`);
    expect(existsSync(path), `app/fonts/${family}-OFL.txt does not exist`).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/SIL Open Font License/i);
    expect(text).toContain(family);
  });

  it("AC4: every font weight app/globals.css and the .tsx files use has a file", () => {
    const named: Record<string, string> = {
      thin: "100", extralight: "200", light: "300", normal: "400", medium: "500",
      semibold: "600", bold: "700", extrabold: "800", black: "900",
    };
    const loaded = new Set(declaredFamilies().flatMap((family) => family.src.map((s) => s.weight)));
    const used = new Map<string, string>(); // weight → the first file asking for it
    for (const file of [join(APP, "globals.css"), ...sources(APP, /\.tsx$/)]) {
      const text = withoutComments(readFileSync(file, "utf8"));
      for (const m of text.matchAll(
        /font-weight\s*:\s*(\d{3}|bold|normal)\b|\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b|\bfont-\[(\d{3})\]|fontWeight\s*:\s*["']?(\d{3})/g,
      )) {
        const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
        const weight = named[raw] ?? raw;
        if (!used.has(weight)) used.set(weight, relative(APP, file));
      }
    }
    expect(used.size, "no font weight found in app/globals.css or the .tsx files").toBeGreaterThan(0);
    expect([...used].filter(([weight]) => !loaded.has(weight))).toEqual([]);
  });

  it("AC4: nothing in app/ imports next/font/google", () => {
    const offenders = sources(APP, /\.(ts|tsx)$/).filter((file) =>
      /from\s+["']next\/font\/google["']|import\(\s*["']next\/font\/google["']\s*\)/.test(
        withoutComments(readFileSync(file, "utf8")),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("AC4: fontVariables is both families' next/font variable class names, joined", () => {
    expect(fontVariables.split(/\s+/).filter(Boolean).sort()).toEqual(["variable--font-montserrat", "variable--font-oswald"]);
  });

  it("AC4: the root layout sets fontVariables on <html>", async () => {
    const html = renderToStaticMarkup(await RootLayout({ children: null }));
    const classes = (/<html\b[^>]*\bclass="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["variable--font-montserrat", "variable--font-oswald"]));
  });
});
