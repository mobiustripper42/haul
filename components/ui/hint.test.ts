// Issue 55, AC17: Hint, the small muted line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { screenMarkup, textsOf, utilitiesOf } from "../../app/screen-test-helpers";
import { Hint } from "./hint";

const render = (id?: string) => renderToStaticMarkup(createElement(Hint, { ...(id ? { id } : {}), children: "So the farm can reach you." }));
const openingTag = (html: string) => /^<\w+\b[^>]*>/.exec(screenMarkup(html))?.[0] ?? "";

describe("AC17 — Hint", () => {
  it("AC17: renders its children, and only them", () => {
    expect(textsOf(render())).toEqual(["So the farm can reach you."]);
  });

  it("AC17: with an id it carries it", () => {
    expect(openingTag(render("phone-help"))).toContain('id="phone-help"');
  });

  it("AC17: with no id it carries none", () => {
    const html = render();
    expect(textsOf(html), "Hint renders nothing yet").toHaveLength(1);
    expect(openingTag(html)).not.toContain(" id=");
  });

  it("issue 84: `below` sets it 8px under the field above it, past the focus ring's 4px; without it, no top margin", () => {
    const classOf = (below: boolean) =>
      utilitiesOf(/class="([^"]*)"/.exec(openingTag(renderToStaticMarkup(createElement(Hint, { below, children: "Help" }))))?.[1]);
    expect(classOf(true)).toContain("mt-2");
    expect(classOf(false).filter((utility) => utility.startsWith("mt-"))).toEqual([]);
  });

  // Issue 140: the danger line on a calendar row ("No menu yet"), in FieldError's colour and Hint's size.
  it("AC8 (issue 140): `danger` draws the danger colour in place of the muted one, at the same size; without it, no danger colour", () => {
    const utilitiesFor = (danger: boolean) =>
      utilitiesOf(/class="([^"]*)"/.exec(openingTag(renderToStaticMarkup(createElement(Hint, { danger, children: "No menu yet" }))))?.[1]);
    const danger = utilitiesFor(true);
    expect(danger).toContain("text-danger");
    expect(danger).toContain("text-small");
    expect(danger.filter((utility) => /^text-(ink|teal)-muted$/.test(utility))).toEqual([]);
    expect(utilitiesFor(false)).not.toContain("text-danger");
  });

  it("AC17: it is small and muted", () => {
    const utilities = utilitiesOf(/class="([^"]*)"/.exec(openingTag(render()))?.[1]);
    expect(utilities).toContain("text-small");
    expect(utilities.some((utility) => /^text-(ink|teal)-muted$/.test(utility))).toBe(true);
  });
});
