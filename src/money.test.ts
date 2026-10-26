import { describe, expect, it } from "vitest";
import { assertCents, formatUsd } from "./money.js";

describe("AC1 — assertCents", () => {
  it.each([0, 1234, -500, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])(
    "returns the integer %d unchanged",
    (value) => {
      expect(assertCents(value)).toBe(value);
    },
  );

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "throws a RangeError on %d",
    (value) => {
      expect(() => assertCents(value)).toThrow(RangeError);
    },
  );
});

describe("AC2 — formatUsd", () => {
  it.each([
    [1234, "$12.34"],
    [0, "$0.00"],
    [-0, "$0.00"],
    [-500, "-$5.00"],
    [100000, "$1,000.00"],
  ])("formats %d cents as %s", (cents, expected) => {
    expect(formatUsd(cents)).toBe(expected);
  });

  it("throws a RangeError on a fractional cent", () => {
    expect(() => formatUsd(12.5)).toThrow(RangeError);
  });
});
