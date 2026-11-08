// Issue 9, AC33: the `limited` value a notice shows. `limitedMinutes` is the one home of the rule, for
// sign-in's form and Create Account's; app/sign-in/sign-in-form.test.ts and
// app/create-account/account-form.test.ts each carry one accepted and one refused case through it.
import { describe, expect, it } from "vitest";
import { limitedMinutes } from "./shared";

describe("AC33 (issue 9) — limitedMinutes", () => {
  it.each([
    ["1", 1],
    ["30", 30],
    ["60", 60],
  ])("AC33: %j is %d minutes", (value, minutes) => {
    expect(limitedMinutes(value)).toBe(minutes);
  });

  it.each(["0", "61", "1.5", "-1", "abc", "", undefined])("AC33: %j shows no notice", (value) => {
    expect(limitedMinutes(value)).toBeNull();
  });
});
