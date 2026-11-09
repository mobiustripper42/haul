import { describe, expect, it } from "vitest";
import { memberDisplayName, normalizeEmail } from "./members.js";

describe("AC7 — normalizeEmail", () => {
  it.each([
    ["  Ada@Example.COM ", "ada@example.com"],
    ["\tBOB@EXAMPLE.ORG\n", "bob@example.org"],
    ["ada@example.com", "ada@example.com"],
  ])("AC7: normalizes %j to %j (trim, lowercase)", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });
});

// Issue 101, AC9: the name step 3 of the Supper Club reads, "First Last". `memberDisplayName` is the one home
// of the rule; app/supper-club/page.test.ts carries a named and a nameless member through it.
describe("AC9 (issue 101) — memberDisplayName", () => {
  it.each([
    ["first and last", "Paula Paid", { firstName: "Paula", lastName: "Paid" }],
    ["first only", "Paula", { firstName: "Paula", lastName: null }],
    ["last only", "Paid", { firstName: null, lastName: "Paid" }],
  ])("AC9: with %s it is %j", (_what, name, member) => {
    expect(memberDisplayName(member)).toBe(name);
  });

  it("AC9: with neither it is null", () => {
    expect(memberDisplayName({ firstName: null, lastName: null })).toBeNull();
  });
});
