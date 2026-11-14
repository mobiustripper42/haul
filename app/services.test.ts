// Issue 9, AC32: the composition root picks the email adapter from the environment, and refuses
// to run production without what it needs. Each test loads it afresh after stubbing the
// environment, so it holds whether the module reads the environment per call or at load.
import { afterEach, describe, expect, it, vi } from "vitest";

const VARS = ["NODE_ENV", "RESEND_API_KEY", "EMAIL_FROM", "DATABASE_URL", "SITE_URL"] as const;
type Env = Partial<Record<(typeof VARS)[number], string>>;

// The dev fake outlives a module reload (issue 31, AC5), so a fresh load also drops it: after
// `vi.resetModules()`, a fake kept from an earlier load is an instance of an earlier `FakeEmail`.
const devEmailGlobal = globalThis as { __haulDevEmail?: unknown };

async function load(env: Env) {
  for (const name of VARS) vi.stubEnv(name, env[name]);
  vi.resetModules();
  delete devEmailGlobal.__haulDevEmail;
  return {
    services: await import("./services"),
    FakeEmail: (await import("@core/adapters/fake-email.js")).FakeEmail,
    ResendEmail: (await import("@core/adapters/resend-email.js")).ResendEmail,
  };
}

const errorOf = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error(`threw a non-Error: ${String(e)}`);
  }
  throw new Error("expected a throw, but it returned");
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const RESEND = { RESEND_API_KEY: "re_test_key_123", EMAIL_FROM: "Ohio City Farm <members@ohiocityfarm.com>" };

describe("AC32 (issue 9) — getEmail", () => {
  it.each(["development", "production"])("AC32: with RESEND_API_KEY and EMAIL_FROM set, NODE_ENV %s, returns a ResendEmail", async (NODE_ENV) => {
    const { services, ResendEmail } = await load({ NODE_ENV, ...RESEND, DATABASE_URL: "postgres://x@localhost/x" });
    expect(services.getEmail()).toBeInstanceOf(ResendEmail);
  });

  it.each([
    ["neither variable", {}],
    ["only RESEND_API_KEY", { RESEND_API_KEY: RESEND.RESEND_API_KEY }],
    ["only EMAIL_FROM", { EMAIL_FROM: RESEND.EMAIL_FROM }],
  ])("AC32: outside production, with %s, returns a FakeEmail", async (_what, vars: Env) => {
    const { services, FakeEmail } = await load({ NODE_ENV: "development", ...vars });
    expect(services.getEmail()).toBeInstanceOf(FakeEmail);
  });

  it("AC32: the dev FakeEmail writes each message to the console — `[email] to <to>: <subject>`, then the text", async () => {
    const { services } = await load({ NODE_ENV: "development" });
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    await services.getEmail().send({
      to: "ada@example.com",
      subject: "Your OCF Member Portal sign-in code",
      text: "Your sign-in code is 042517.\n\nIt expires in 10 minutes.",
    });
    const output = spies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map(String).join(" "))
      .join("\n");
    const line = output.indexOf("[email] to ada@example.com: Your OCF Member Portal sign-in code");
    const text = output.indexOf("Your sign-in code is 042517.\n\nIt expires in 10 minutes.");
    expect(line).toBeGreaterThanOrEqual(0);
    expect(text).toBeGreaterThan(line);
  });

  it.each([
    ["neither variable", {}],
    ["only RESEND_API_KEY", { RESEND_API_KEY: RESEND.RESEND_API_KEY }],
    ["only EMAIL_FROM", { EMAIL_FROM: RESEND.EMAIL_FROM }],
  ])("AC32: in production, with %s, throws an error naming both variables", async (_what, vars: Env) => {
    const { services } = await load({ NODE_ENV: "production", DATABASE_URL: "postgres://x@localhost/x", ...vars });
    const error = errorOf(() => services.getEmail());
    expect(error.message).toContain("RESEND_API_KEY");
    expect(error.message).toContain("EMAIL_FROM");
  });
});

describe("AC5 (issue 31) — one dev FakeEmail per process, on globalThis", () => {
  const silenceConsole = () => vi.spyOn(console, "log").mockImplementation(() => {});

  it("AC5: outside production, with Resend unconfigured, getEmail() returns devEmail()", async () => {
    const { services } = await load({ NODE_ENV: "development" });
    expect(services.getEmail()).toBe(services.devEmail());
  });

  it("AC5: devEmail() returns the same FakeEmail on every call, the one at globalThis.__haulDevEmail", async () => {
    const { services, FakeEmail } = await load({ NODE_ENV: "development" });
    const fake = services.devEmail();
    expect(fake).toBeInstanceOf(FakeEmail);
    expect(services.devEmail()).toBe(fake);
    expect(devEmailGlobal.__haulDevEmail).toBe(fake);
  });

  it("AC5: a second, separately loaded copy of app/services.ts sends into the same sent list", async () => {
    silenceConsole();
    const { services: first } = await load({ NODE_ENV: "development" });
    const fromFirst = { to: "eric@ocf.xx", subject: "from the first copy", text: "111111" };
    await first.getEmail().send(fromFirst);

    // As Next loads one copy for the action and another for the route: no reset of the global.
    vi.resetModules();
    const second = await import("./services");
    expect(second).not.toBe(first);
    const fromSecond = { to: "eric@ocf.xx", subject: "from the second copy", text: "222222" };
    await second.getEmail().send(fromSecond);

    expect(first.devEmail().sent).toEqual([fromFirst, fromSecond]);
    expect(second.devEmail().sent).toEqual([fromFirst, fromSecond]);
  });
});

describe("AC17 (issue 22) — getSiteUrl", () => {
  const SITE = "https://members.ohiocityfarm.com";

  it.each(["development", "production"])("AC17: with SITE_URL set, NODE_ENV %s, returns SITE_URL", async (NODE_ENV) => {
    const { services } = await load({ NODE_ENV, SITE_URL: SITE });
    expect(services.getSiteUrl()).toBe(SITE);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("AC17: outside production, with SITE_URL %s, returns http://localhost:4000", async (_what, SITE_URL) => {
    const { services } = await load({ NODE_ENV: "development", SITE_URL });
    expect(services.getSiteUrl()).toBe("http://localhost:4000");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("AC17: in production, with SITE_URL %s, throws an error naming SITE_URL", async (_what, SITE_URL) => {
    const { services } = await load({ NODE_ENV: "production", SITE_URL });
    expect(errorOf(() => services.getSiteUrl()).message).toContain("SITE_URL");
  });

  it.each([
    ["http://", "http://members.ohiocityfarm.com"],
    ["no scheme", "members.ohiocityfarm.com"],
  ])("AC17: in production, with a SITE_URL that does not start with https:// (%s), throws an error naming SITE_URL", async (_what, SITE_URL) => {
    const { services } = await load({ NODE_ENV: "production", SITE_URL });
    expect(errorOf(() => services.getSiteUrl()).message).toContain("SITE_URL");
  });

  it("AC17: outside production, an http:// SITE_URL is returned as set", async () => {
    const { services } = await load({ NODE_ENV: "development", SITE_URL: "http://localhost:4100" });
    expect(services.getSiteUrl()).toBe("http://localhost:4100");
  });
});

// Issue 141: the email weekday, read from the env by the core's menuEmailWeekday (whose edge cases are
// src/menu-run.test.ts's): one accepted and one refused case through it, and read per call.
describe("AC2 (issue 141) — getMenuEmailWeekday", () => {
  it("AC2: with MENU_EMAIL_WEEKDAY 4 it is 4, and it is read again at each call", async () => {
    vi.stubEnv("MENU_EMAIL_WEEKDAY", "4");
    const { services } = await load({ NODE_ENV: "production" });
    expect(services.getMenuEmailWeekday()).toBe(4);
    vi.stubEnv("MENU_EMAIL_WEEKDAY", "6");
    expect(services.getMenuEmailWeekday()).toBe(6);
  });

  it("AC2: with MENU_EMAIL_WEEKDAY unset it throws, in every environment", async () => {
    vi.stubEnv("MENU_EMAIL_WEEKDAY", undefined);
    const { services } = await load({ NODE_ENV: "development" });
    expect(() => services.getMenuEmailWeekday()).toThrow();
  });
});

describe("AC16 (issue 57) — getFarmContactEmail", () => {
  it("AC16: with FARM_CONTACT_EMAIL set it returns it", async () => {
    vi.stubEnv("FARM_CONTACT_EMAIL", "farm@ohiocityfarm.com");
    const { services } = await load({ NODE_ENV: "development" });
    expect(services.getFarmContactEmail()).toBe("farm@ohiocityfarm.com");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("AC16: with FARM_CONTACT_EMAIL %s it is undefined, which guards the line above", async (_what, value) => {
    vi.stubEnv("FARM_CONTACT_EMAIL", value);
    const { services } = await load({ NODE_ENV: "production" });
    expect(services.getFarmContactEmail()).toBeUndefined();
  });
});

describe("AC32 (issue 9) — getRepository", () => {
  it("AC32: in production without DATABASE_URL it throws an error naming DATABASE_URL", async () => {
    const { services } = await load({ NODE_ENV: "production", ...RESEND });
    expect(() => services.getRepository()).toThrow(/DATABASE_URL/);
  });
});

describe("AC8 (issue 56) — getPayments", () => {
  const SQUARE = { SQUARE_ACCESS_TOKEN: "EAAA-test-token", SQUARE_LOCATION_ID: "LOCATION_MAIN" };
  const NAMES = ["NODE_ENV", "SQUARE_ENVIRONMENT", "SQUARE_ACCESS_TOKEN", "SQUARE_LOCATION_ID"] as const;

  async function loadPayments(env: Partial<Record<(typeof NAMES)[number], string>>) {
    for (const name of NAMES) vi.stubEnv(name, env[name]);
    vi.resetModules();
    return {
      services: await import("./services"),
      FakePayments: (await import("@core/adapters/fake-payments.js")).FakePayments,
      SquarePayments: (await import("@core/adapters/square-payments.js")).SquarePayments,
    };
  }

  it.each(["development", "production"])("AC8: with the token and location set and a valid SQUARE_ENVIRONMENT, NODE_ENV %s, it returns SquarePayments", async (NODE_ENV) => {
    const { services, SquarePayments } = await loadPayments({ NODE_ENV, ...SQUARE, SQUARE_ENVIRONMENT: "sandbox" });
    expect(services.getPayments()).toBeInstanceOf(SquarePayments);
  });

  it.each([
    ["sandbox", "https://connect.squareupsandbox.com/v2/customers/search"],
    ["production", "https://connect.squareup.com/v2/customers/search"],
  ])("AC8: SQUARE_ENVIRONMENT %s picks Square's base URL", async (SQUARE_ENVIRONMENT, url) => {
    const { services } = await loadPayments({ NODE_ENV: "development", ...SQUARE, SQUARE_ENVIRONMENT });
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ customers: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      await services.getPayments().findCustomersByEmail("ada@example.com");
      expect(fetch.mock.calls[0]?.[0]).toBe(url);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["development", "test"])("AC8: without them, NODE_ENV %s, it returns the fake, which guards the two production refusals", async (NODE_ENV) => {
    const { services, FakePayments } = await loadPayments({ NODE_ENV });
    expect(services.getPayments()).toBeInstanceOf(FakePayments);
  });

  it.each([
    ["neither variable", {}],
    ["only SQUARE_ACCESS_TOKEN", { SQUARE_ACCESS_TOKEN: SQUARE.SQUARE_ACCESS_TOKEN }],
    ["only SQUARE_LOCATION_ID", { SQUARE_LOCATION_ID: SQUARE.SQUARE_LOCATION_ID }],
  ])("AC8: in production, with %s, it throws, so a misconfigured production takes no free signup", async (_what, vars) => {
    const { services } = await loadPayments({ NODE_ENV: "production", ...vars });
    expect(() => services.getPayments()).toThrow();
  });

  it.each(
    ["development", "test", "production"].flatMap((NODE_ENV) => [
      [NODE_ENV, "unset", undefined],
      [NODE_ENV, "invalid", "staging"],
      [NODE_ENV, "empty", ""],
    ]),
  )("AC8: NODE_ENV %s, with the token and location set and SQUARE_ENVIRONMENT %s, it throws", async (NODE_ENV, _what, SQUARE_ENVIRONMENT) => {
    const { services } = await loadPayments({ NODE_ENV: NODE_ENV as string, ...SQUARE, ...(SQUARE_ENVIRONMENT === undefined ? {} : { SQUARE_ENVIRONMENT }) });
    expect(() => services.getPayments()).toThrow();
  });
});
