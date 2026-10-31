import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("AC6 — the gate", () => {
  it("chains the doc checks, then typecheck, typecheck:app, lint, test, build, with &&", () => {
    const steps = scripts.verify.split(" && ").map((s) => s.trim());
    expect(steps).toEqual([
      "npm run check:decisions",
      "npm run check:dictionary",
      "npm run check:context",
      "npm run check:docs",
      "npm run check:denied",
      "npm run typecheck",
      "npm run typecheck:app",
      "npm run typecheck:db",
      "npm run lint",
      "npm run test",
      "npm run build",
    ]);
  });

  it.each(["typecheck", "typecheck:app", "lint", "test", "build"])("defines the %s script", (name) => {
    expect(scripts[name]).toBeTruthy();
  });
});

// Resolved options and file list for a tsconfig, as tsc itself would read them.
const profile = (file) => {
  const path = `${root}${file}`;
  const { config, error } = ts.readConfigFile(path, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  return ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, path);
};

describe("AC11 — typecheck:db joins the gate, and lint reaches db/", () => {
  it("AC11: verify runs typecheck:db immediately after typecheck:app", () => {
    const steps = scripts.verify.split(" && ").map((s) => s.trim());
    expect(steps.indexOf("npm run typecheck:db")).toBe(steps.indexOf("npm run typecheck:app") + 1);
  });

  it("AC11: typecheck:db is tsc -p tsconfig.db.json", () => {
    expect(scripts["typecheck:db"]).toBe("tsc -p tsconfig.db.json");
  });

  it("AC11: tsconfig.db.json checks the db/ scripts", () => {
    const { fileNames } = profile("tsconfig.db.json");
    expect(fileNames).toEqual(expect.arrayContaining([`${root}db/migrate.ts`, `${root}db/new-migration.ts`]));
  });

  it("AC11: tsconfig.db.json uses the core's compiler options", () => {
    const options = (file) => {
      const resolved = { ...profile(file).options };
      delete resolved.configFilePath;
      return resolved;
    };
    expect(options("tsconfig.db.json")).toEqual(options("tsconfig.core.json"));
  });

  it("AC11: lint covers db/", () => {
    expect(scripts.lint.split(/\s+/)).toContain("db");
  });
});

const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

describe("AC9 (issue 31) — e2e runs on its own command, never in the gate", () => {
  it("AC9: test:e2e is playwright test", () => {
    expect(scripts["test:e2e"]).toBe("playwright test");
  });

  it("AC9: verify does not run test:e2e or playwright", () => {
    expect(scripts.verify).not.toMatch(/test:e2e|playwright/);
  });

  it("AC9: Vitest collects nothing under e2e/", () => {
    const run = spawnSync(`${root}node_modules/.bin/vitest`, ["list", "--filesOnly", "--json"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const files = JSON.parse(run.stdout).map((entry) => relative(root, entry.file));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => file.split(sep)[0] === "e2e")).toEqual([]);
  }, 30_000);
});

describe("AC11 (issue 31) — lint, typecheck:app and .gitignore reach the e2e harness", () => {
  it("AC11: lint covers e2e/", () => {
    expect(scripts.lint.split(/\s+/)).toContain("e2e");
  });

  it("AC11: lint covers playwright.config.ts", () => {
    expect(scripts.lint.split(/\s+/).some((arg) => arg === "playwright.config.ts" || arg === "*.config.ts")).toBe(true);
  });

  it("AC11: typecheck:app is tsc -p tsconfig.json", () => {
    expect(scripts["typecheck:app"]).toBe("tsc -p tsconfig.json");
  });

  it("AC11: tsconfig.json checks e2e/ and playwright.config.ts", () => {
    const { fileNames } = profile("tsconfig.json");
    expect(fileNames).toEqual(
      expect.arrayContaining([
        `${root}e2e/sign-in.spec.ts`,
        `${root}e2e/fixtures.ts`,
        `${root}e2e/database.ts`,
        `${root}e2e/global-setup.ts`,
        `${root}playwright.config.ts`,
      ]),
    );
  });

  it.each([".next-e2e/trace", "test-results/.last-run.json", "playwright-report/index.html"])(
    "AC11: .gitignore ignores %s",
    (path) => {
      // --no-index, so the answer comes from .gitignore whatever the index holds.
      expect(git("check-ignore", "--no-index", "-q", path).status).toBe(0);
    },
  );
});

describe("AC8 — the command the skip message names exists", () => {
  it("AC8: db:up starts the database and waits for it", () => {
    expect(scripts["db:up"]).toBe("docker compose up -d --wait");
  });
});
