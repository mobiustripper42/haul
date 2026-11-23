// Issue 245, AC3: the one rule every link component asks, "is this href in the app?". It is in-app when `safeReturnTo`
// (src/return-to.ts) returns it unchanged. Its edge cases live here; Button and TextLink each take one in-app and one
// other href through it (button.test.ts, text-link.test.ts).
import { describe, expect, it } from "vitest";
import { isInAppHref } from "./in-app-href";

describe("AC3 (issue 245) — isInAppHref", () => {
  it.each([
    ["the home page", "/"],
    ["a page", "/admin/menus"],
    ["a nested page", "/account/weeks"],
    ["a page with a query", "/admin/weeks?note=2026-11-29"],
    ["a page with a query and a fragment", "/admin/weeks?note=2026-11-29#open-panel"],
    ["a file the app serves", "/admin/members.csv"],
  ])("AC3: %s, %j, is in-app", (_what, href) => {
    expect(isInAppHref(href)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["a mailto: link", "mailto:farm@example.com"],
    ["a tel: link", "tel:+12165550102"],
    ["an http: link", "http://example.com/account"],
    ["an https: link", "https://example.com/account"],
    ["a protocol-relative link", "//example.com/account"],
    ["a fragment alone", "#open-panel"],
    ["a relative path", "account"],
    ["a path holding a backslash", "/\\example.com"],
    ["a path holding a tab", "/\t/example.com"],
    ["a path holding a newline", "/account\n"],
    ["a path holding DEL", "/account\u007f"],
  ])("AC3: %s, %j, is not in-app", (_what, href) => {
    expect(isInAppHref(href)).toBe(false);
  });
});
