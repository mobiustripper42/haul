// Issue 159, AC2: MenuGroup, a `<details>` whose panel holds what it is given. Issue 266: the header no longer draws one,
// so it is a row's More alone (components/ui/row-actions.tsx); how it opens and closes is by hand.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, screenMarkup } from "../../app/screen-test-helpers";
import { MenuGroup } from "./menu-group";

const render = () => screenMarkup(renderToStaticMarkup(createElement(MenuGroup, { label: "Group", children: createElement("a", { href: "/inside" }, "Inside") })));

/** The markup inside the first `<details>`, after its `<summary>`: the panel. */
const panelOf = (html: string): string => (/<details\b[^>]*>([\s\S]*)<\/details>/.exec(html)?.[1] ?? "").split("</summary>")[1] ?? "";

describe("AC2 (issue 159) — MenuGroup holds its links", () => {
  it("AC2: its children are its panel: inside the <details>, after the <summary>", () => {
    expect(attributesOf(panelOf(render()), "a").map((link) => link.href)).toEqual(["/inside"]);
  });
});
