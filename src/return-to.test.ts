// Issue 55, AC13: a return path that could leave the site is never followed.
import { describe, expect, it } from "vitest";
import { returnToOr, safeReturnTo } from "./return-to.js";

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

  // Browsers strip tabs and newlines from a URL, so each of the first three reads as //evil.com.
  it.each([
    ["a tab", "/\t/evil.com"],
    ["a newline", "/\n/evil.com"],
    ["a carriage return", "/\r/evil.com"],
    ["U+007F", "/\u007f/evil.com"],
    ["U+0000, the first of the range", "/\u0000/evil.com"],
    ["U+001F, the last of the range", "/\u001f/evil.com"],
    ["a control character at the very end", "/supper-club?size=four\n"],
  ])("AC13: a path holding %s is /", (_what, value) => {
    expect(safeReturnTo(value)).toBe("/");
  });
});

describe("AC6 (issue 77) — returnToOr", () => {
  it("AC6: no value at all gives the fallback", () => {
    expect(returnToOr(undefined, "/supper-club")).toBe("/supper-club");
  });

  it("AC6: a safe path is kept, over the fallback", () => {
    expect(returnToOr("/supper-club?size=four&menu=vegan", "/elsewhere")).toBe("/supper-club?size=four&menu=vegan");
  });

  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "/\t/evil.com", ""])(
    "AC6: an unsafe value (%j) gives /, as safeReturnTo does, and never the fallback",
    (value) => {
      expect(returnToOr(value, "/supper-club")).toBe("/");
    },
  );
});
