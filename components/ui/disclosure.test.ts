// Issue 243: Disclosure, the rolldown: a <details> with no script, so the browser opens and closes it and it is read here
// by its element, its `open` and what it holds. Which week's is open is the page's (app/account/weeks/page.test.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, textsOf } from "../../app/screen-test-helpers";
import { Disclosure } from "./disclosure";

const draw = (open?: boolean): string =>
  renderToStaticMarkup(createElement(Disclosure, { summary: "Autumn harvest", ...(open === undefined ? {} : { open }), children: createElement("p", null, "Squash soup") }));

describe("AC8, AC11 (issue 243) — Disclosure", () => {
  it("AC8: a <details> whose <summary> is `summary`, then its children", () => {
    const html = draw();
    expect(attributesOf(html, "details")).toHaveLength(1);
    expect(textsOf(/<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? "")).toEqual(["Autumn harvest"]);
    expect(textsOf(html)).toEqual(["Autumn harvest", "Squash soup"]);
  });

  it("AC11: it is open when `open` is true, and closed when it is false or not given", () => {
    expect([draw(true), draw(false), draw()].map((html) => attributesOf(html, "details").map((details) => "open" in details))).toEqual([[true], [false], [false]]);
  });
});
