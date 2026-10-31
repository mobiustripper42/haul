// Issue 9, AC32: the composition root picks the email adapter from the environment, and refuses
// to run production without what it needs. Each test loads it afresh after stubbing the
// environment, so it holds whether the module reads the environment per call or at load.
import { afterEach, describe, expect, it, vi } from "vitest";

const VARS = ["NODE_ENV", "RESEND_API_KEY", "EMAIL_FROM", "DATABASE_URL"] as const;
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

describe("AC32 (issue 9) — getRepository", () => {
  it("AC32: in production without DATABASE_URL it throws an error naming DATABASE_URL", async () => {
    const { services } = await load({ NODE_ENV: "production", ...RESEND });
    expect(() => services.getRepository()).toThrow(/DATABASE_URL/);
  });
});
