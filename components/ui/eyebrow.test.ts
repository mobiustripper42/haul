// Issue 55, AC17: Eyebrow, the label line in its two tones.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { screenMarkup, textsOf, utilitiesOf } from "../../app/screen-test-helpers";
import { Eyebrow } from "./eyebrow";

const render = (tone: "teal" | "muted") => renderToStaticMarkup(createElement(Eyebrow, { tone, children: "A SAMPLE WEEK" }));
const utilities = (tone: "teal" | "muted") => utilitiesOf(/class="([^"]*)"/.exec(screenMarkup(render(tone)))?.[1]);

describe("AC17 — Eyebrow", () => {
  it.each(["teal", "muted"] as const)("AC17: with tone %s renders its children in the label style", (tone) => {
    expect(textsOf(render(tone))).toEqual(["A SAMPLE WEEK"]);
    expect(utilities(tone)).toContain("text-label");
  });

  it('AC17: tone "teal" is teal', () => {
    expect(utilities("teal")).toContain("text-teal");
  });

  it('AC17: tone "muted" is a muted text colour, not teal', () => {
    expect(utilities("muted").some((utility) => /^text-(ink|teal)-muted$/.test(utility))).toBe(true);
    expect(utilities("muted")).not.toContain("text-teal");
  });
});
