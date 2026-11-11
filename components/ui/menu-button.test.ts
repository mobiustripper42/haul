// Issue 155, AC9: MenuButton, the signed-in header's Menu below 720px: a disclosure, `<details>` and `<summary>`
// (so it opens with no client script), named by its label, its panel holding what it is given. Where the header
// puts it, and what is in its panel, is app/site-header.test.ts's.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, screenMarkup, textsOf } from "../../app/screen-test-helpers";
import { MenuButton } from "./menu-button";

const render = () => screenMarkup(renderToStaticMarkup(createElement(MenuButton, { label: "Menu", children: createElement("a", { href: "/account" }, "Your meal") })));

/** The markup inside the first `<summary>`, or undefined. */
const summaryOf = (html: string): string | undefined => /<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1];

describe("AC9 (issue 155) — MenuButton", () => {
  it("AC9: it is a <details> whose <summary> is named by the label alone", () => {
    const html = render();
    expect(html).toMatch(/<details\b/);
    expect(textsOf(summaryOf(html) ?? "")).toEqual(["Menu"]);
  });

  it("AC9: the three-line icon is hidden from screen readers, so the label is the summary's name", () => {
    const icons = attributesOf(summaryOf(render()) ?? "", "svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]?.["aria-hidden"]).toBe("true");
  });

  it("AC9: its children are the panel: inside the <details>, after the <summary>", () => {
    const inside = /<details\b[^>]*>([\s\S]*)<\/details>/.exec(render())?.[1] ?? "";
    expect(textsOf(inside.split("</summary>")[1] ?? "")).toEqual(["Your meal"]);
  });
});
