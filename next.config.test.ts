// Issue 31, AC3: the e2e server builds into its own directory, so it holds its own dev lock and
// starts beside `npm run dev`. Each test loads the config afresh after stubbing E2E.
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

async function load(e2e: string | undefined): Promise<NextConfig> {
  vi.stubEnv("E2E", e2e);
  vi.resetModules();
  return (await import("./next.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AC3 — distDir follows E2E", () => {
  it("AC3: with E2E=1, distDir is .next-e2e", async () => {
    expect((await load("1")).distDir).toBe(".next-e2e");
  });

  it("AC3: without E2E, distDir is not set", async () => {
    expect((await load(undefined)).distDir).toBeUndefined();
  });

  it("AC3: with E2E=1, the rest of the config is what it is without E2E", async () => {
    const plain = await load(undefined);
    expect(await load("1")).toEqual({ ...plain, distDir: ".next-e2e" });
  });
});
