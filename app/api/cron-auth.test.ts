// Issue 141, AC1: the cron check both cron routes share, `authorizedCron`, its edge cases owned here. It is the charge
// run's check moved out of app/api/charge-run/route.ts, so these are the cases that route's tests hold through its GET
// (app/api/charge-run/route.test.ts, left as it is), held once at the function. Each route keeps one accepted and one
// refused case. The module is wrapped, not replaced, so that "both routes use this one function, not a copy" can be
// read off the spy: here for the charge run's route, in app/api/menu-run/route.test.ts for the menu run's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as chargeRun } from "./charge-run/route";
import { authorizedCron } from "./cron-auth";

vi.mock("./cron-auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("./cron-auth")>();
  return { ...real, authorizedCron: vi.fn(real.authorizedCron) };
});

const SECRET = "cron-secret-0123456789abcdefghij";
/** As long as SECRET, and not it. */
const SAME_LENGTH = "cron-secret-0123456789abcdefghiJ";

const request = (authorization?: string): Request =>
  new Request("http://localhost/api/menu-run", authorization === undefined ? {} : { headers: { authorization } });

beforeEach(() => {
  vi.mocked(authorizedCron).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AC1 — authorizedCron", () => {
  it("AC1: with CRON_SECRET set, Authorization: Bearer <it> is authorized", () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(authorizedCron(request(`Bearer ${SECRET}`))).toBe(true);
  });

  it.each([
    ["no Authorization header", undefined],
    ["a wrong secret of the same length", `Bearer ${SAME_LENGTH}`],
    ["a wrong secret longer than it, starting with it", `Bearer ${SECRET}x`],
    ["a wrong secret shorter than it", `Bearer ${SECRET.slice(0, -1)}`],
    ["the scheme in lowercase", `bearer ${SECRET}`],
    ["two spaces after the scheme", `Bearer  ${SECRET}`],
    ["another scheme", `Basic ${SECRET}`],
    ["the secret alone, with no scheme", SECRET],
  ])("AC1: with CRON_SECRET set, %s is not authorized", (_what, authorization) => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(authorizedCron(request(authorization))).toBe(false);
  });

  it("AC1: with CRON_SECRET unset, Bearer undefined is not authorized", () => {
    vi.stubEnv("CRON_SECRET", undefined);
    expect(authorizedCron(request("Bearer undefined"))).toBe(false);
  });

  it("AC1: an empty CRON_SECRET counts as unset: Bearer with nothing after it is not authorized", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(authorizedCron(request("Bearer "))).toBe(false);
  });

  it("AC1: CRON_SECRET is read at each call: changed after a first call, the old secret is refused and the new one let through", () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(authorizedCron(request(`Bearer ${SECRET}`))).toBe(true);
    vi.stubEnv("CRON_SECRET", SAME_LENGTH);
    expect(authorizedCron(request(`Bearer ${SECRET}`))).toBe(false);
    expect(authorizedCron(request(`Bearer ${SAME_LENGTH}`))).toBe(true);
  });
});

describe("AC1 — the charge run's route uses it, not a copy", () => {
  it("AC1: GET /api/charge-run asks authorizedCron about the request it was given, and a refusal is its 404", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const refused = request(`Bearer ${SAME_LENGTH}`);

    const response = await chargeRun(refused);

    expect(authorizedCron).toHaveBeenCalledWith(refused);
    expect(response.status).toBe(404);
  });
});
