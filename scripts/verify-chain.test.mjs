import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
      "npm run lint",
      "npm run test",
      "npm run build",
    ]);
  });

  it.each(["typecheck", "typecheck:app", "lint", "test", "build"])("defines the %s script", (name) => {
    expect(scripts[name]).toBeTruthy();
  });
});
