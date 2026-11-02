// Issue 38, AC6: Notice renders the alert the screens hand-wrote (app/sign-in/page.tsx:24-31,
// app/sign-in/code/page.tsx:24-27).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalMarkup } from "../../app/screen-test-helpers";
import { Notice, type NoticeIcon } from "./notice";

describe("AC6 — Notice", () => {
  it.each(["lock", "clock", "alert"] as const)(
    'AC6: with icon %s renders <p role="alert" class="notice notice-<icon>"> around its children, and nothing else',
    (icon: NoticeIcon) => {
      const html = renderToStaticMarkup(createElement(Notice, { icon, children: "Try again in 5 min." }));
      expect(normalMarkup(html)).toBe(normalMarkup(`<p role="alert" class="notice notice-${icon}">Try again in 5 min.</p>`));
    },
  );
});
