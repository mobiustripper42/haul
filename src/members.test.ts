import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./members.js";

describe("AC7 — normalizeEmail", () => {
  it.each([
    ["  Ada@Example.COM ", "ada@example.com"],
    ["\tBOB@EXAMPLE.ORG\n", "bob@example.org"],
    ["ada@example.com", "ada@example.com"],
  ])("AC7: normalizes %j to %j (trim, lowercase)", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });
});
