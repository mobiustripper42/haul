// Issue 54, AC22: the settings `npm run test:square` builds SquarePayments from. Sandbox always,
// from the sandbox's own variables, and a missing one fails the run rather than skipping it.
import { describe, expect, it } from "vitest";
import { squareSandboxSettings } from "./square-sandbox-settings.js";

const TOKEN = "EAAAl-sandbox-token";
const LOCATION = "LSANDBOX123";
const both = { SQUARE_SANDBOX_ACCESS_TOKEN: TOKEN, SQUARE_SANDBOX_LOCATION_ID: LOCATION };

/** What `fn` threw, or an Error saying it didn't. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return new Error("did not throw");
}

describe("AC22 (issue 54) — squareSandboxSettings", () => {
  it("AC22: returns { accessToken, locationId, environment: \"sandbox\" } from the two sandbox variables", () => {
    expect(squareSandboxSettings({ ...both })).toStrictEqual({
      accessToken: TOKEN,
      locationId: LOCATION,
      environment: "sandbox",
    });
  });

  it("AC22: environment is \"sandbox\" whatever else env holds", () => {
    const settings = squareSandboxSettings({
      ...both,
      SQUARE_ENVIRONMENT: "production",
      SQUARE_SANDBOX_ENVIRONMENT: "production",
      ENVIRONMENT: "production",
      NODE_ENV: "production",
    });
    expect(settings.environment).toBe("sandbox");
    expect(settings.accessToken).toBe(TOKEN);
  });

  it.each([
    ["SQUARE_SANDBOX_ACCESS_TOKEN", "missing", { SQUARE_SANDBOX_LOCATION_ID: LOCATION }],
    ["SQUARE_SANDBOX_ACCESS_TOKEN", "empty", { SQUARE_SANDBOX_ACCESS_TOKEN: "", SQUARE_SANDBOX_LOCATION_ID: LOCATION }],
    ["SQUARE_SANDBOX_LOCATION_ID", "missing", { SQUARE_SANDBOX_ACCESS_TOKEN: TOKEN }],
    ["SQUARE_SANDBOX_LOCATION_ID", "empty", { SQUARE_SANDBOX_ACCESS_TOKEN: TOKEN, SQUARE_SANDBOX_LOCATION_ID: "" }],
  ])("AC22: with %s %s, throws an Error naming it", (variable, _how, env) => {
    const error = thrownBy(() => squareSandboxSettings(env));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(variable);
  });

  it("AC22: never reads the app's own SQUARE_* variables in place of the sandbox's", () => {
    const error = thrownBy(() =>
      squareSandboxSettings({ SQUARE_ACCESS_TOKEN: TOKEN, SQUARE_SANDBOX_LOCATION_ID: LOCATION }),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("SQUARE_SANDBOX_ACCESS_TOKEN");
  });
});
