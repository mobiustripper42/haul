// Issue 38, AC3: Heading renders the page title the screens hand-wrote (app/sign-in/page.tsx:22).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, normalMarkup, textsOf } from "../../app/screen-test-helpers";
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

// Issue 243: the second title on a page of two lists. Level 2 without `look` is the test above.
describe("AC1 (issue 243) — Heading at level 2 in the title's style", () => {
  it('AC1: level={2} look="title" is an h2, no h1, drawn as the title is', () => {
    const title = attributesOf(renderToStaticMarkup(createElement(Heading, null, "Upcoming weeks")), "h1")[0];
    const html = renderToStaticMarkup(createElement(Heading, { level: 2, look: "title" }, "History"));
    expect(attributesOf(html, "h1")).toEqual([]);
    expect(attributesOf(html, "h2").map((heading) => heading.class)).toEqual([title?.class]);
    expect(textsOf(html)).toEqual(["History"]);
  });
});
