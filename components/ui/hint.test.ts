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

  it("AC17: it is small and muted", () => {
    const utilities = utilitiesOf(/class="([^"]*)"/.exec(openingTag(render()))?.[1]);
    expect(utilities).toContain("text-small");
    expect(utilities.some((utility) => /^text-(ink|teal)-muted$/.test(utility))).toBe(true);
  });
});
