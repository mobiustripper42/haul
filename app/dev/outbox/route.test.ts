// Issue 31, AC6-AC8: the dev outbox, the one way an e2e test reads back an emailed sign-in code.
// Each test loads the route and the composition root afresh, after stubbing the environment, and
// drops the process-wide dev fake (AC5) so no test sees another's messages.
import { afterEach, describe, expect, it, vi } from "vitest";

const devEmailGlobal = globalThis as { __haulDevEmail?: unknown };

type Env = { NODE_ENV: string; RESEND_API_KEY?: string; EMAIL_FROM?: string };
const RESEND = { RESEND_API_KEY: "re_test_key_123", EMAIL_FROM: "Ohio City Farm <members@ohiocityfarm.com>" };

async function load(env: Env) {
  vi.stubEnv("NODE_ENV", env.NODE_ENV);
  vi.stubEnv("RESEND_API_KEY", env.RESEND_API_KEY);
  vi.stubEnv("EMAIL_FROM", env.EMAIL_FROM);
  vi.resetModules();
  delete devEmailGlobal.__haulDevEmail;
  // The dev fake prints every message it sends.
  vi.spyOn(console, "log").mockImplementation(() => {});
  return {
    services: await import("../../services"),
    route: await import("./route"),
  };
}

const outbox = (route: { GET: (request: Request) => Response | Promise<Response> }, query: string) =>
  Promise.resolve(route.GET(new Request(`http://localhost:4100/dev/outbox${query}`)));

const SUBJECT = "Your OCF Member Portal sign-in code";
const eric1 = { to: "eric@ocf.xx", subject: SUBJECT, text: "Your sign-in code is 111111." };
const lenny = { to: "lenny@ocf.xx", subject: SUBJECT, text: "Your sign-in code is 222222." };
const eric2 = { to: "eric@ocf.xx", subject: SUBJECT, text: "Your sign-in code is 333333." };

afterEach(() => {
  vi.doUnmock("../../services");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete devEmailGlobal.__haulDevEmail;
});

describe("AC6 — outside production, GET /dev/outbox?to= lists what the dev fake sent to that address", () => {
  it("AC6: returns 200 and every message sent to the address, oldest first, as { to, subject, text }", async () => {
    const { services, route } = await load({ NODE_ENV: "development" });
    for (const message of [eric1, lenny, eric2]) await services.getEmail().send(message);

    const response = await outbox(route, `?to=${encodeURIComponent("eric@ocf.xx")}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [eric1, eric2] });
  });

  it("AC6: matches ignoring case and surrounding space, on the query and on each message's to, and returns to as it was sent", async () => {
    const { services, route } = await load({ NODE_ENV: "development" });
    const shouted = { to: " Eric@OCF.xx ", subject: SUBJECT, text: "Your sign-in code is 444444." };
    for (const message of [shouted, lenny, eric1]) await services.getEmail().send(message);

    const response = await outbox(route, `?to=${encodeURIComponent("  ERIC@ocf.XX ")}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [shouted, eric1] });
  });

  it("AC6: an address with no messages returns 200 and { messages: [] }", async () => {
    const { services, route } = await load({ NODE_ENV: "development" });
    await services.getEmail().send(lenny);

    const response = await outbox(route, `?to=${encodeURIComponent("eric@ocf.xx")}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [] });
  });
});

describe("AC7 — outside production, a missing or blank to is a 400", () => {
  it.each([
    ["no query", ""],
    ["no to, another parameter", `?email=${encodeURIComponent("eric@ocf.xx")}`],
    ["an empty to", "?to="],
    ["a to of only spaces", `?to=${encodeURIComponent("   ")}`],
  ])("AC7: %s returns 400", async (_what, query) => {
    const { route } = await load({ NODE_ENV: "development" });
    expect((await outbox(route, query)).status).toBe(400);
  });
});

describe("AC8 — in production the outbox is a 404 that never touches an email adapter", () => {
  const QUERIES = [
    ["a member's address", `?to=${encodeURIComponent("eric@ocf.xx")}`],
    ["no query", ""],
    ["a blank to", "?to="],
  ];

  // getEmail and devEmail wrapped in spies; the rest of the composition root, isProduction with it, is real.
  async function loadWithSpies(env: Env) {
    vi.doMock("../../services", async (importOriginal) => {
      const real = await importOriginal<typeof import("../../services")>();
      return { ...real, getEmail: vi.fn(real.getEmail), devEmail: vi.fn(real.devEmail) };
    });
    return load(env);
  }

  it.each(QUERIES)("AC8: with Resend configured, %s returns 404 without building or reading an adapter", async (_what, query) => {
    const { services, route } = await loadWithSpies({ NODE_ENV: "production", ...RESEND });

    expect((await outbox(route, query)).status).toBe(404);
    expect(services.getEmail).not.toHaveBeenCalled();
    expect(services.devEmail).not.toHaveBeenCalled();
    expect(devEmailGlobal.__haulDevEmail).toBeUndefined();
  });

  it.each(QUERIES)("AC8: with Resend unconfigured, %s returns 404 without building or reading an adapter", async (_what, query) => {
    const { services, route } = await loadWithSpies({ NODE_ENV: "production" });

    expect((await outbox(route, query)).status).toBe(404);
    expect(services.getEmail).not.toHaveBeenCalled();
    expect(services.devEmail).not.toHaveBeenCalled();
    expect(devEmailGlobal.__haulDevEmail).toBeUndefined();
  });
});
