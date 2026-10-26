import { readFileSync } from "node:fs";
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

describe("AC8 — the command the skip message names exists", () => {
  it("AC8: db:up starts the database and waits for it", () => {
    expect(scripts["db:up"]).toBe("docker compose up -d --wait");
  });
});
