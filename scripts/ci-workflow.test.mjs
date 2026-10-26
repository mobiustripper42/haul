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
