// Issue 240: WaitingLabel, the one place the ring and the words it covers are drawn, for buttons and links alike. When it
// is busy is SubmitButton's and LinkLabel's, and whether the covered words stay in a control's accessible name is the
// browser's: e2e/tap-feedback.spec.ts. The ring is Spinner, whose look is by hand.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, textsOf } from "../../app/screen-test-helpers";
import { Spinner } from "./spinner";
import { WaitingLabel } from "./waiting-label";

const render = (busy: boolean) => renderToStaticMarkup(createElement(WaitingLabel, { busy, children: createElement("b", null, "Words") }));

/** The elements carrying `attribute="true"`. */
const marked = (html: string, attribute: string) => attributesOf(html, "[a-z]+").filter((attributes) => attributes[attribute] === "true");

describe("AC3, AC10 — WaitingLabel", () => {
  it("AC3, AC10: at rest it is its children alone: no wrapper, no ring and no mark", () => {
    expect(render(false)).toBe("<b>Words</b>");
  });

  it('AC3, AC10: busy, it is marked aria-busy="true" once', () => {
    expect(marked(render(true), "aria-busy")).toHaveLength(1);
  });

  it("AC3, AC10: busy, it draws one ring, Spinner's aria-hidden span, and nothing else in it is aria-hidden", () => {
    const html = render(true);
    expect(html.split(renderToStaticMarkup(createElement(Spinner))).length - 1).toBe(1);
    expect(marked(html, "aria-hidden")).toHaveLength(1);
  });

  it("AC3, AC10: busy, its children are still there, and the words are there once", () => {
    const html = render(true);
    expect(html).toContain("<b>Words</b>");
    expect(textsOf(html)).toEqual(["Words"]);
  });
});
