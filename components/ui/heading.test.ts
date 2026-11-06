// Issue 38, AC3: Heading renders the page title the screens hand-wrote (app/sign-in/page.tsx:22).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalMarkup } from "../../app/screen-test-helpers";
import { Heading } from "./heading";

describe("AC3 — Heading", () => {
  it('AC3: renders <h1 class="font-display text-heading text-teal"> around its children, and nothing else', () => {
    const html = renderToStaticMarkup(createElement(Heading, null, "Sign in"));
    expect(normalMarkup(html)).toBe(normalMarkup('<h1 class="font-display text-heading text-teal">Sign in</h1>'));
  });
});

describe("AC7 (issue 59) — Heading at level 2", () => {
  it('AC7 (issue 59): level 2 renders <h2 class="font-display text-section text-teal"> around its children, and nothing else', () => {
    const html = renderToStaticMarkup(createElement(Heading, { level: 2 }, "No members yet"));
    expect(normalMarkup(html)).toBe(normalMarkup('<h2 class="font-display text-section text-teal">No members yet</h2>'));
  });
});
