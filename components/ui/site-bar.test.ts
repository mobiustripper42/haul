// Issue 97: SiteBar, the one home for the bar the header and the footer share. The class strings are
// exact and in this token order, because app/screens-unchanged.test.ts compares the header's markup
// exactly and `normalMarkup` does not sort class tokens.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteBar } from "./site-bar";

const INNER_HEADER = "mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-3";
const INNER_FOOTER = "mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-5";

const render = (as: "header" | "footer") =>
  renderToStaticMarkup(createElement(SiteBar, { as, children: createElement("p", null, "child") }));

describe("SiteBar", () => {
  it("AC3: as header it is today's header frame, unchanged, around its children", () => {
    expect(render("header")).toBe(
      `<header class="border-b border-divider bg-surface"><div class="${INNER_HEADER}"><p>child</p></div></header>`,
    );
  });

  it("AC7: as footer it is a <footer> pushed to the bottom, its divider on top, the inner row with py-5, around its children", () => {
    expect(render("footer")).toBe(
      `<footer class="mt-auto border-t border-divider bg-surface"><div class="${INNER_FOOTER}"><p>child</p></div></footer>`,
    );
  });
});
