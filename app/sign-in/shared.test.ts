// Issue 9, AC33: the `limited` value a notice shows. `limitedMinutes` is the one home of the rule, for
// sign-in's form and Create Account's; app/sign-in/sign-in-form.test.ts and
// app/create-account/account-form.test.ts each carry one accepted and one refused case through it.
import { describe, expect, it } from "vitest";
import { limitedMinutes, limitedText } from "./shared";

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

// Issue 101, AC5: the limited notice's minutes. `limitedText` carries them into the line; the substitution and the
// singular or plural choice are `translate`'s and `pluralKey`'s (src/i18n.test.ts), so only the value is asserted here.
describe("AC5 (issue 101) — limitedText", () => {
  it.each([1, 2, 5, 60])("AC5: at %d minutes the line carries that many", (minutes) => {
    expect(limitedText("en", minutes)).toMatch(new RegExp(`\\b${minutes}\\b`));
  });
});
