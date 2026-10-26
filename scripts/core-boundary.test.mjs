// The core under src/ stays framework-free (DEC-001): lint refuses a framework or app import there,
// and the core's NodeNext profile refuses an extensionless relative import.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { afterAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd: root });

const ruleIds = async (code, filePath) => {
  const [result] = await eslint.lintText(code, { filePath: join(root, filePath) });
  return result.messages.map((m) => m.ruleId);
};

describe("AC3 — lint keeps the framework out of src/", () => {
  it.each([
    'import { notFound } from "next/navigation";',
    'import Link from "next/link";',
    'import { useState } from "react";',
    'import { createRoot } from "react-dom/client";',
    'import Page from "../app/page";',
    'import Page from "@/app/page";',
  ])("fails in src/: %s", async (line) => {
    expect(await ruleIds(`${line}\nexport {};\n`, "src/boundary-probe.ts")).toContain("no-restricted-imports");
  });

  it.each([
    'import { notFound } from "next/navigation";',
    'import { useState } from "react";',
  ])("passes in app/: %s", async (line) => {
    expect(await ruleIds(`${line}\nexport {};\n`, "app/boundary-probe.ts")).not.toContain("no-restricted-imports");
  });
});

describe("AC4 — the core profile refuses an extensionless relative import", () => {
  const dir = mkdtempSync(join(tmpdir(), "haul-core-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const typecheck = (importLine) => {
    // The repo is "type": "module"; the fixture's own package.json says the same, or NodeNext
    // reads the fixture as CommonJS and fails for that reason instead.
    writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
    writeFileSync(join(dir, "b.ts"), "export const b = 1;\n");
    writeFileSync(join(dir, "a.ts"), `${importLine}\nexport const a = b;\n`);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ extends: join(root, "tsconfig.core.json"), include: [join(dir, "*.ts")] }),
    );
    try {
      execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", join(dir, "tsconfig.json")], { stdio: "pipe" });
      return "";
    } catch (e) {
      return String(e.stdout) || "tsc failed with no output";
    }
  };

  it("fails without the extension", () => {
    expect(typecheck('import { b } from "./b";')).toMatch(/TS2835|relative import paths need explicit file extensions/i);
  });

  it("passes with the .js extension", () => {
    expect(typecheck('import { b } from "./b.js";')).toBe("");
  });
});
