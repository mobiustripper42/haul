// Issue 38, AC1: Shell renders the page frame the screens hand-wrote (app/sign-in/page.tsx:20).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, normalMarkup, screenMarkup } from "../../app/screen-test-helpers";
import { Shell } from "./shell";

describe("AC1 — Shell", () => {
  it('AC1: renders <main class="page-narrow"> around its children, and nothing else', () => {
    const html = renderToStaticMarkup(createElement(Shell, null, createElement("p", null, "one"), createElement("p", null, "two")));
    expect(normalMarkup(html)).toBe(normalMarkup('<main class="page-narrow"><p>one</p><p>two</p></main>'));
  });
});

// Issue 55: `width`. Shell is called with the new prop, as the spec shapes it.
describe("AC17 (issue 55) — Shell's width", () => {
  const render = (width: "narrow" | "page") => renderToStaticMarkup(createElement(Shell, { width, children: createElement("p", null, "one") }));

  it('AC17: width="narrow" is today\'s page-narrow', () => {
    expect(normalMarkup(render("narrow"))).toBe(normalMarkup('<main class="page-narrow"><p>one</p></main>'));
  });

  it('AC17: width="page" renders <main> around its children, without page-narrow, in a look of its own', () => {
    const html = render("page");
    expect(screenMarkup(html)).toMatch(/^<main\b[^>]*>\s*<p>one<\/p>\s*<\/main>$/);
    const classes = (attributesOf(html, "main")[0]?.class ?? "").split(/\s+/).filter(Boolean);
    expect(classes).not.toEqual([]);
    expect(classes).not.toContain("page-narrow");
  });
});
