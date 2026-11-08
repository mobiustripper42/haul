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

// Issue 101, AC5: the limited notice's words, singular at one minute. `limitedText` is their one home; the
// plural choice itself is `pluralKey`'s (src/i18n.test.ts), and sign-in's form and Create Account's each
// carry one case through `limitedText` (app/sign-in/sign-in-form.test.ts, app/create-account/account-form.test.ts).
describe("AC5 (issue 101) — limitedText", () => {
  it('AC5: at one minute it reads "Try again in 1 minute."', () => {
    expect(limitedText("en", 1)).toBe("Too many sign-in requests from this network. Try again in 1 minute.");
  });

  it.each([2, 5, 60])('AC5: at %d minutes it reads "Try again in {minutes} minutes."', (minutes) => {
    expect(limitedText("en", minutes)).toBe(`Too many sign-in requests from this network. Try again in ${minutes} minutes.`);
  });
});
