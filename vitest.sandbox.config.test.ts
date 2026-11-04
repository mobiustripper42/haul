// Issue 54, AC22 and AC23: `npm run test:square` runs the *.sandbox.ts suites, and `npm run test`
// (and so `verify`) runs none of them. Each config's `include` is globbed from the root as vitest
// globs it, falling back to vitest's own default when a config sets none.
import { globSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";
import base from "./vitest.config";
import sandbox from "./vitest.sandbox.config";

const root = fileURLToPath(new URL(".", import.meta.url));
const SKIPPED_DIRS = new Set(["node_modules", ".git", ".next", ".next-e2e", ".sessions-worktree"]);

/** The files a config's `include` selects, relative to the root. */
function selectedBy(config: { test?: { include?: string[] } }): string[] {
  const include = config.test?.include ?? configDefaults.include;
  return globSync(include, { cwd: root, exclude: (path: string) => SKIPPED_DIRS.has(basename(path)) }).sort();
}

const SANDBOX_SUITE = "src/adapters/square-payments.sandbox.ts";

describe("AC23 (issue 54) — the default run leaves the sandbox suites out", () => {
  it("AC23: vitest.config.ts selects no *.sandbox.ts file", () => {
    const selected = selectedBy(base);
    expect(selected).toContain("src/adapters/fake-payments.test.ts");
    expect(selected.filter((file) => file.endsWith(".sandbox.ts"))).toEqual([]);
  });

  it("AC23: vitest.sandbox.config.ts selects the sandbox suite and no *.test.ts file", () => {
    const selected = selectedBy(sandbox);
    expect(selected).toContain(SANDBOX_SUITE);
    expect(selected.filter((file) => file.endsWith(".test.ts"))).toEqual([]);
  });
});

describe("AC22 (issue 54) — npm run test:square", () => {
  it("AC22: package.json's test:square is vitest run --config vitest.sandbox.config.ts --reporter=verbose", () => {
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["test:square"]).toBe("vitest run --config vitest.sandbox.config.ts --reporter=verbose");
  });
});
