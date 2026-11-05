// Issue 55, AC17: Panel, the sage panel, its title through Eyebrow.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalMarkup, screenMarkup, textsOf, utilitiesOf } from "../../app/screen-test-helpers";
import { Eyebrow } from "./eyebrow";
import { Panel } from "./panel";

const render = () =>
  renderToStaticMarkup(createElement(Panel, { title: "A SAMPLE WEEK", children: createElement("p", null, "Shish tawook") }));

describe("AC17 — Panel", () => {
  it("AC17: renders its title, then its children", () => {
    expect(textsOf(render())).toEqual(["A SAMPLE WEEK", "Shish tawook"]);
  });

  it('AC17: its title is an Eyebrow with tone="teal"', () => {
    const eyebrow = renderToStaticMarkup(createElement(Eyebrow, { tone: "teal", children: "A SAMPLE WEEK" }));
    expect(textsOf(eyebrow), "Eyebrow renders nothing yet").toEqual(["A SAMPLE WEEK"]);
    expect(normalMarkup(render())).toContain(normalMarkup(eyebrow));
  });

  it("AC17: it is the sage panel", () => {
    const classes = /^<\w+\b[^>]*\bclass="([^"]*)"/.exec(screenMarkup(render()))?.[1];
    expect(utilitiesOf(classes)).toContain("bg-sage-soft");
  });
});
