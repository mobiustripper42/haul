// Issue 38, AC1: Shell renders the page frame the screens hand-wrote (app/sign-in/page.tsx:20).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalMarkup } from "../../app/screen-test-helpers";
import { Shell } from "./shell";

describe("AC1 — Shell", () => {
  it('AC1: renders <main class="page-narrow"> around its children, and nothing else', () => {
    const html = renderToStaticMarkup(createElement(Shell, null, createElement("p", null, "one"), createElement("p", null, "two")));
    expect(normalMarkup(html)).toBe(normalMarkup('<main class="page-narrow"><p>one</p><p>two</p></main>'));
  });
});
