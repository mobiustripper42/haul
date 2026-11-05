// Issue 38, AC2: Card renders the card the screens hand-wrote (app/sign-in/page.tsx:21).
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, normalMarkup, screenMarkup, utilitiesOf } from "../../app/screen-test-helpers";
import { Card } from "./card";

describe("AC2 — Card", () => {
  it('AC2: renders <section class="card"> around its children, and nothing else', () => {
    const html = renderToStaticMarkup(createElement(Card, null, createElement("h1", null, "one"), createElement("p", null, "two")));
    expect(normalMarkup(html)).toBe(normalMarkup('<section class="card"><h1>one</h1><p>two</p></section>'));
  });
});

// Issue 55: `width`. Card is called with the new prop, as the spec shapes it. utilitiesOf reads the
// class's rule in app/globals.css, because `max-w-card` lives there and not in the markup.
describe("AC17 (issue 55) — Card's width", () => {
  const render = (width?: "card" | "fill") =>
    renderToStaticMarkup(createElement(Card, { ...(width ? { width } : {}), children: createElement("p", null, "one") }));

  it.each([
    ["no width", undefined],
    ['width="card"', "card"],
  ] as const)("AC17: %s is today's card, max-w-card and all", (_what, width) => {
    const html = render(width);
    expect(normalMarkup(html)).toBe(normalMarkup('<section class="card"><p>one</p></section>'));
    expect(utilitiesOf(attributesOf(html, "section")[0]?.class)).toContain("max-w-card");
  });

  it('AC17: width="fill" is a card around its children with no max-w-card', () => {
    const html = render("fill");
    expect(screenMarkup(html)).toMatch(/^<section\b[^>]*>\s*<p>one<\/p>\s*<\/section>$/);
    const utilities = utilitiesOf(attributesOf(html, "section")[0]?.class);
    expect(utilities).toEqual(expect.arrayContaining(["w-full", "bg-surface", "shadow-card"]));
    expect(utilities).not.toContain("max-w-card");
  });
});

// Issue 77: `width="pane"`. Card width and centred below lg, full width at lg, are measured in a
// browser (e2e/supper-club.spec.ts); these hold the class and that it shares the card's body.
describe("AC3 and AC11 (issue 77) — Card's pane width", () => {
  const css = () => readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it('AC11: width="pane" renders <section class="card-pane"> around its children', () => {
    const html = renderToStaticMarkup(createElement(Card, { width: "pane", children: createElement("p", null, "one") } as never));
    expect(normalMarkup(html)).toBe(normalMarkup('<section class="card-pane"><p>one</p></section>'));
  });

  it("AC3: .card-pane carries the card's body, in app/globals.css", () => {
    expect(utilitiesOf("card-pane")).toEqual(expect.arrayContaining(["w-full", "bg-surface", "shadow-card"]));
  });

  it("AC3: the card's body is not written a third time", () => {
    expect(css().match(/(?<![\w-])shadow-card(?![\w-])/g)?.length ?? 0).toBeLessThanOrEqual(2);
  });
});
