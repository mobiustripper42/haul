// Issue 243: TwoColumns, the layout Your account and Upcoming weeks share. Which width stands the columns side by side, and
// where a link to the right one scrolls, only a browser can measure (e2e/account-weeks.spec.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { textsOf } from "../../app/screen-test-helpers";
import { TwoColumns } from "./two-columns";

const LEFT = createElement("p", null, "Left");
const RIGHT = createElement("p", null, "Right");

describe("AC1 (issue 243) — TwoColumns", () => {
  it("AC1: the left column is read before the right, and rightId is the id of the right one alone", () => {
    const html = renderToStaticMarkup(createElement(TwoColumns, { left: LEFT, right: RIGHT, rightId: "second" }));
    expect(textsOf(html)).toEqual(["Left", "Right"]);
    expect(html.split('id="second"')).toHaveLength(2);
    const [before = "", after = ""] = html.split('id="second"');
    expect(textsOf(`${before}>`)).toContain("Left");
    expect(textsOf(`<div ${after}`)).toEqual(["Right"]);
  });

  it("AC1: with no rightId neither column has an id", () => {
    const html = renderToStaticMarkup(createElement(TwoColumns, { left: LEFT, right: RIGHT }));
    expect(textsOf(html)).toEqual(["Left", "Right"]);
    expect(html).not.toMatch(/\sid="/);
  });
});
