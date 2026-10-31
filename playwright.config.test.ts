// Issue 31, AC1, AC2 and AC4: the Playwright harness, read as Playwright itself reads it. Each
// test loads the config afresh after stubbing the environment, since it reads CI and
// TEST_DATABASE_URL when it loads.
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { devices } from "@playwright/test";
import type { PlaywrightTestConfig } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./src/adapters/pg-connect.js";
import { ensureTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "./src/adapters/test-database.js";
import { e2eDatabaseUrl } from "./e2e/database";
import globalSetup from "./e2e/global-setup";

const root = fileURLToPath(new URL(".", import.meta.url));

// Playwright's own matcher for testMatch, and its default when testMatch is unset (1.63.0).
const { createFileMatcher } = createRequire(import.meta.url)("playwright/lib/util") as {
  createFileMatcher: (patterns: unknown) => (filePath: string) => boolean;
};
const PLAYWRIGHT_DEFAULT_TEST_MATCH = "**/*.@(spec|test).?(c|m)[jt]s?(x)";

const CI_TEST_DATABASE_URL = "postgres://haul:haul@localhost:5432/haul_test";

async function load(env: { CI?: string; TEST_DATABASE_URL?: string } = {}): Promise<PlaywrightTestConfig> {
  vi.stubEnv("CI", env.CI);
  vi.stubEnv("TEST_DATABASE_URL", env.TEST_DATABASE_URL);
  // What a shell running `npm run dev` may export; the e2e server must not inherit it.
  vi.stubEnv("DATABASE_URL", "postgres://haul:haul@localhost:5434/haul_dev");
  vi.resetModules();
  return (await import("./playwright.config")).default;
}

const projectsOf = (config: PlaywrightTestConfig) => config.projects ?? [];
const projectNamed = (config: PlaywrightTestConfig, name: string) => projectsOf(config).find((p) => p.name === name);
/** A project's `use` as Playwright applies it: the config's, with the project's own over it. */
const useOf = (config: PlaywrightTestConfig, name: string) => ({ ...config.use, ...projectNamed(config, name)?.use });
const webServersOf = (config: PlaywrightTestConfig) => [config.webServer ?? []].flat();

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AC1 — two projects, desktop and mobile, over e2e/*.spec.ts", () => {
  it("AC1: has exactly two projects, desktop and mobile", async () => {
    const config = await load();
    expect(projectsOf(config).map((p) => p.name).sort()).toEqual(["desktop", "mobile"]);
  });

  it("AC1: desktop is Desktop Chrome at 1280×800", async () => {
    const config = await load();
    expect(projectNamed(config, "desktop")).toBeDefined();
    expect(useOf(config, "desktop")).toMatchObject({
      ...devices["Desktop Chrome"],
      viewport: { width: 1280, height: 800 },
    });
  });

  it("AC1: mobile is Pixel 7 — Chromium with touch — at 375×812", async () => {
    const config = await load();
    expect(projectNamed(config, "mobile")).toBeDefined();
    const pixel7 = devices["Pixel 7"];
    expect(useOf(config, "mobile")).toMatchObject({
      defaultBrowserType: "chromium",
      userAgent: pixel7.userAgent,
      deviceScaleFactor: pixel7.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
      viewport: { width: 375, height: 812 },
    });
  });

  it("AC1: every project's testDir is e2e", async () => {
    const config = await load();
    expect(projectsOf(config)).not.toHaveLength(0);
    for (const project of projectsOf(config)) {
      expect(resolve(root, project.testDir ?? config.testDir ?? ".")).toBe(resolve(root, "e2e"));
    }
  });

  it("AC1: every project matches *.spec.ts only", async () => {
    const config = await load();
    expect(projectsOf(config)).not.toHaveLength(0);
    for (const project of projectsOf(config)) {
      const matches = createFileMatcher(project.testMatch ?? config.testMatch ?? PLAYWRIGHT_DEFAULT_TEST_MATCH);
      expect(matches(resolve(root, "e2e/sign-in.spec.ts"))).toBe(true);
      for (const file of [
        "e2e/fixtures.ts",
        "e2e/database.ts",
        "e2e/global-setup.ts",
        "e2e/sign-in.test.ts",
        "e2e/sign-in.spec.js",
        "e2e/sign-in.spec.tsx",
      ]) {
        expect(matches(resolve(root, file)), file).toBe(false);
      }
    }
  });

  it("AC1: runs one worker, not fully parallel", async () => {
    const config = await load();
    expect(config.workers).toBe(1);
    expect(config.fullyParallel).toBeFalsy();
    for (const project of projectsOf(config)) expect(project.fullyParallel, project.name).toBeFalsy();
  });

  it("AC1: with CI set, forbids test.only and retries once", async () => {
    const config = await load({ CI: "true" });
    expect(config.forbidOnly).toBe(true);
    expect(projectsOf(config)).not.toHaveLength(0);
    for (const project of projectsOf(config)) expect(project.retries ?? config.retries, project.name).toBe(1);
  });

  it("AC1: locally, neither forbids test.only nor retries", async () => {
    const config = await load({ CI: undefined });
    expect(config.forbidOnly).toBeFalsy();
    expect(config.retries ?? 0).toBe(0);
    for (const project of projectsOf(config)) expect(project.retries ?? config.retries ?? 0, project.name).toBe(0);
  });
});

describe("AC2 — one next dev server on 4100, pointed at the e2e database", () => {
  it("AC2: has one web server, running ./node_modules/.bin/next dev --webpack --port 4100", async () => {
    const servers = webServersOf(await load());
    expect(servers).toHaveLength(1);
    expect(servers[0]?.command).toBe("./node_modules/.bin/next dev --webpack --port 4100");
  });

  it("AC2: its environment sets E2E=1, DATABASE_URL to the e2e database, and RESEND_API_KEY and EMAIL_FROM empty", async () => {
    const [server] = webServersOf(await load({ TEST_DATABASE_URL: undefined }));
    expect(server?.env).toMatchObject({
      E2E: "1",
      DATABASE_URL: "postgres://haul:haul@localhost:5434/haul_test_e2e",
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
    });
  });

  it("AC2: its environment sets a fixed SESSION_SECRET of 32 or more characters", async () => {
    const first = webServersOf(await load())[0]?.env?.SESSION_SECRET;
    const second = webServersOf(await load())[0]?.env?.SESSION_SECRET;
    expect(typeof first).toBe("string");
    expect(first?.length ?? 0).toBeGreaterThanOrEqual(32);
    expect(second).toBe(first);
  });

  it("AC2: every project's baseURL is http://localhost:4100", async () => {
    const config = await load();
    expect(projectsOf(config)).not.toHaveLength(0);
    for (const project of projectsOf(config)) {
      expect(useOf(config, project.name ?? "").baseURL, project.name).toBe("http://localhost:4100");
    }
  });

  it("AC2: reuses an existing server locally", async () => {
    const [server] = webServersOf(await load({ CI: undefined }));
    expect(server?.reuseExistingServer).toBe(true);
  });

  it("AC2: never reuses an existing server with CI set", async () => {
    const [server] = webServersOf(await load({ CI: "true" }));
    expect(server).toBeDefined();
    expect(server?.reuseExistingServer).toBe(false);
  });
});

describe("AC4 — the e2e database is the test database's name with _e2e", () => {
  it("AC4: e2eDatabaseUrl() defaults to TEST_DATABASE_URL — haul_test_e2e locally", async () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    vi.resetModules();
    const fresh = await import("./e2e/database");
    expect(fresh.e2eDatabaseUrl()).toBe("postgres://haul:haul@localhost:5434/haul_test_e2e");
  });

  it("AC4: e2eDatabaseUrl(base) appends _e2e to the base's database name, keeping its query", () => {
    expect(e2eDatabaseUrl(`${CI_TEST_DATABASE_URL}?sslmode=disable`)).toBe(
      "postgres://haul:haul@localhost:5432/haul_test_e2e?sslmode=disable",
    );
  });

  it("AC4: the web server's DATABASE_URL follows TEST_DATABASE_URL", async () => {
    const [server] = webServersOf(await load({ TEST_DATABASE_URL: CI_TEST_DATABASE_URL }));
    expect(server?.env?.DATABASE_URL).toBe("postgres://haul:haul@localhost:5432/haul_test_e2e");
  });

  it("AC4: the config's global setup is e2e/global-setup.ts", async () => {
    const config = await load();
    const setups = [config.globalSetup ?? []].flat().map((p) => resolve(root, p).replace(/\.ts$/, ""));
    expect(setups).toEqual([resolve(root, "e2e/global-setup")]);
  });
});

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC4 — the e2e database, created and migrated by global setup${skipped}`, () => {
  const name = `${new URL(TEST_DATABASE_URL).pathname.slice(1)}_e2e`;

  const withClient = async <T>(url: string, fn: (client: ReturnType<typeof createClient>) => Promise<T>) => {
    const client = createClient(url);
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  };
  const adminUrl = () => {
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = "/postgres";
    return url.toString();
  };
  const exists = async () =>
    (await withClient(adminUrl(), (c) => c.query("select 1 from pg_database where datname = $1", [name]))).rows.length === 1;

  // The create path runs every time.
  beforeEach(async () => {
    await withClient(adminUrl(), (c) => c.query(`drop database if exists "${name}" with (force)`));
  });

  it("AC4: e2eDatabaseUrl() names the database ensureTestDatabase(TEST_DATABASE_URL, \"e2e\") creates", async () => {
    await expect(ensureTestDatabase(TEST_DATABASE_URL, "e2e")).resolves.toBe(e2eDatabaseUrl());
  });

  it("AC4: global setup, called with no config, creates the e2e database and applies every migration", async () => {
    await globalSetup();

    expect(await exists()).toBe(true);
    const migrations = readdirSync(resolve(root, "db/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    const { rows } = await withClient(url.toString(), (c) =>
      c.query<{ filename: string }>("select filename from _migrations order by filename"),
    );
    expect(rows.map((r) => r.filename)).toEqual(migrations);
  }, 30_000);

  it("AC4: global setup runs again, with the database already there and migrated, without throwing", async () => {
    await globalSetup();
    await expect(globalSetup()).resolves.toBeUndefined();
  }, 30_000);
});
