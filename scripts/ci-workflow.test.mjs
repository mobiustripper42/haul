// CI runs the whole gate against a real Postgres, with CI set, so the Postgres contract can't skip.
import { existsSync, readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

const path = new URL("../.github/workflows/ci.yml", import.meta.url);
const workflow = existsSync(path) ? parseYaml(readFileSync(path, "utf8")) : {};
const job = workflow?.jobs?.verify ?? {};
const steps = job.steps ?? [];
const indexOf = (match) => steps.findIndex(match);
const verifyStep = steps.find((s) => s.run === "npm run verify") ?? {};

const TEST_DATABASE_URL = "postgres://haul:haul@localhost:5432/haul_test";

describe("AC10 — the CI workflow", () => {
  it("AC10: exists at .github/workflows/ci.yml", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("AC10: runs on a pull request targeting main and on a push to main", () => {
    expect(workflow.on?.pull_request?.branches).toContain("main");
    expect(workflow.on?.push?.branches).toContain("main");
  });

  it("AC10: has a verify job with a postgres:17 service on 5432 that TEST_DATABASE_URL can reach", () => {
    const service = job.services?.postgres ?? {};
    const url = new URL(TEST_DATABASE_URL);
    expect(service.image).toBe("postgres:17");
    expect(service.ports).toContain("5432:5432");
    expect(service.env?.POSTGRES_USER).toBe(url.username);
    expect(service.env?.POSTGRES_PASSWORD).toBe(url.password);
    expect(service.env?.POSTGRES_DB).toBe(url.pathname.slice(1));
  });

  it("AC10: checks out, sets up Node 22 with the npm cache, runs npm ci, then npm run verify — in that order", () => {
    const checkout = indexOf((s) => s.uses === "actions/checkout@v5");
    const setupNode = indexOf((s) => s.uses === "actions/setup-node@v5");
    const ci = indexOf((s) => s.run === "npm ci");
    const verify = indexOf((s) => s.run === "npm run verify");

    expect([checkout, setupNode, ci, verify].every((i) => i >= 0)).toBe(true);
    expect(checkout).toBeLessThan(setupNode);
    expect(setupNode).toBeLessThan(ci);
    expect(ci).toBeLessThan(verify);

    const node = steps[setupNode]?.with ?? {};
    expect(String(node["node-version"])).toBe("22");
    expect(node.cache).toBe("npm");
  });

  it("AC10: the verify step sets TEST_DATABASE_URL to the service and CI to \"true\" in its own env", () => {
    expect(verifyStep.env?.TEST_DATABASE_URL).toBe(TEST_DATABASE_URL);
    expect(verifyStep.env?.CI).toBe("true");
  });
});

describe("AC10 (issue 31) — the e2e job", () => {
  const e2e = workflow?.jobs?.e2e ?? {};
  const e2eSteps = e2e.steps ?? [];
  const at = (match) => e2eSteps.findIndex(match);
  const isInstall = (s) =>
    typeof s.run === "string" && /\bplaywright install\b/.test(s.run) && /--with-deps\b/.test(s.run) && /\bchromium\b/.test(s.run);
  const isRun = (s) => s.run === "npm run test:e2e";
  const isUpload = (s) => typeof s.uses === "string" && s.uses.startsWith("actions/upload-artifact@");

  it("AC10: an e2e job sits beside verify", () => {
    expect(Object.keys(workflow?.jobs ?? {})).toEqual(expect.arrayContaining(["verify", "e2e"]));
  });

  it("AC10: has its own postgres:17 service on 5432 that TEST_DATABASE_URL can reach", () => {
    const service = e2e.services?.postgres ?? {};
    const url = new URL(TEST_DATABASE_URL);
    expect(service.image).toBe("postgres:17");
    expect(service.ports).toContain("5432:5432");
    expect(service.env?.POSTGRES_USER).toBe(url.username);
    expect(service.env?.POSTGRES_PASSWORD).toBe(url.password);
    expect(service.env?.POSTGRES_DB).toBe(url.pathname.slice(1));
  });

  it("AC10: checks out, sets up Node 22 with the npm cache, runs npm ci, installs Chromium with its system dependencies, then runs npm run test:e2e — in that order", () => {
    const order = [
      at((s) => s.uses === "actions/checkout@v5"),
      at((s) => s.uses === "actions/setup-node@v5"),
      at((s) => s.run === "npm ci"),
      at(isInstall),
      at(isRun),
    ];
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const node = e2eSteps[order[1]]?.with ?? {};
    expect(String(node["node-version"])).toBe("22");
    expect(node.cache).toBe("npm");
  });

  it("AC10: installs Chromium through the local binary, not npx", () => {
    const install = e2eSteps.find(isInstall);
    expect(install).toBeDefined();
    expect(install.run).not.toMatch(/\bnpx\b/);
  });

  it("AC10: the test:e2e step sets TEST_DATABASE_URL to the service and CI to \"true\" in its own env", () => {
    const step = e2eSteps.find(isRun) ?? {};
    expect(step.env?.TEST_DATABASE_URL).toBe(TEST_DATABASE_URL);
    expect(step.env?.CI).toBe("true");
  });

  it("AC10: uploads playwright-report/ after the run, only when it fails", () => {
    const upload = at(isUpload);
    expect(upload).toBeGreaterThan(at(isRun));
    expect(at(isRun)).toBeGreaterThanOrEqual(0);
    const step = e2eSteps[upload];
    expect(String(step.if ?? "")).toMatch(/^(\$\{\{\s*)?failure\(\)(\s*\}\})?$/);
    expect(String(step.with?.path ?? "").replace(/\/$/, "")).toBe("playwright-report");
  });
});
