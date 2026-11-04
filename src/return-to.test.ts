// Issue 55, AC13: a return path that could leave the site is never followed.
import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to.js";

describe("AC13 — safeReturnTo", () => {
  it.each(["/", "/supper-club", "/supper-club?size=four&menu=vegan"])("AC13: %j, a path on this site, is kept", (path) => {
    expect(safeReturnTo(path)).toBe(path);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
  ])("AC13: %s is /", (_what, value) => {
    expect(safeReturnTo(value)).toBe("/");
  });

  it.each(["supper-club", "https://evil.com", "http://evil.com/supper-club", "javascript:alert(1)", " /supper-club"])(
    "AC13: %j does not start with / and is /",
    (value) => {
      expect(safeReturnTo(value)).toBe("/");
    },
  );

  it.each(["//evil.com", "//evil.com/supper-club", "///evil.com"])("AC13: %j starts with // and is /", (value) => {
    expect(safeReturnTo(value)).toBe("/");
  });

  it.each(["/\\evil.com", "\\\\evil.com", "/supper-club\\..\\evil", "/supper-club?next=\\evil"])(
    "AC13: %j holds a backslash, wherever, and is /",
    (value) => {
      expect(safeReturnTo(value)).toBe("/");
    },
  );
});
