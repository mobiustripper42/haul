// Issue 194: whether comps count toward the cap, read from COMPS_COUNT_TOWARD_CAP. The app's composition root hands the
// answer to the repository it builds (app/services.ts); what the repository does with it is the signup contract's AC6.
import { describe, expect, it } from "vitest";
import { compsCountTowardCap } from "./comps.js";

describe("AC7 — compsCountTowardCap", () => {
  it("AC7: true is true", () => {
    expect(compsCountTowardCap({ COMPS_COUNT_TOWARD_CAP: "true" })).toBe(true);
  });

  it("AC7: unset is false", () => {
    expect(compsCountTowardCap({})).toBe(false);
  });

  it.each(["", "false", "TRUE", "True", "1", "yes", " true", "true "])("AC7: any value other than true is false: %j", (value) => {
    expect(compsCountTowardCap({ COMPS_COUNT_TOWARD_CAP: value })).toBe(false);
  });
});
