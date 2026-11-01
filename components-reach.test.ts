// Issue 38, AC20: `npm run lint`, `npm run typecheck:app` and `npm run test` reach components/.
// Before this task each named app/ and not components/ (package.json, tsconfig.json, vitest.config.ts).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "./vitest.config";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("AC20 — the gate's commands reach components/", () => {
  it("AC20: npm run lint names components among the paths it lints", () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    const args = (scripts.lint ?? "").split(/\s+/).slice(1);
    expect(args[0], "the lint script is not eslint").toBeDefined();
    expect(
      args.some((arg) => arg === "." || arg.replace(/\/$/, "") === "components" || arg.startsWith("components/")),
      `npm run lint is "${scripts.lint ?? ""}"`,
    ).toBe(true);
  });

  it("AC20: npm run typecheck:app's tsconfig.json takes every component in components/ui/ as a root file", () => {
    const shown = JSON.parse(
      execFileSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", join(ROOT, "tsconfig.json"), "--showConfig"], { encoding: "utf8" }),
    ) as { files?: string[] };
    const files = (shown.files ?? []).map((f) => f.replace(/^\.\//, ""));
    for (const name of ["shell", "card", "heading", "field", "input", "notice", "button"]) {
      expect(files, `components/ui/${name}.tsx`).toContain(`components/ui/${name}.tsx`);
    }
  });

  it("AC20: npm run test's vitest config includes components/**/*.test.ts", () => {
    expect(config.test?.include ?? []).toContain("components/**/*.test.ts");
  });
});
