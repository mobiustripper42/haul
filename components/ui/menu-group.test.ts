// Issue 159, AC2 and AC3: MenuGroup, the signed-in header's Admin ▾ group at 1024px and wider: a `<details>` whose
// panel holds what it is given, its `<summary>` carrying `data-active` when the page showing is one of its links. Which
// links the header puts in it, and when it is active, is app/site-header.test.ts's; how it opens and closes is by hand.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, screenMarkup } from "../../app/screen-test-helpers";
import { MenuGroup } from "./menu-group";

const render = (active: boolean) =>
  screenMarkup(renderToStaticMarkup(createElement(MenuGroup, { label: "Group", active, children: createElement("a", { href: "/inside" }, "Inside") })));

/** The markup inside the first `<details>`, after its `<summary>`: the panel. */
const panelOf = (html: string): string => (/<details\b[^>]*>([\s\S]*)<\/details>/.exec(html)?.[1] ?? "").split("</summary>")[1] ?? "";

describe("AC2 (issue 159) — MenuGroup holds its links", () => {
  it("AC2: its children are its panel: inside the <details>, after the <summary>", () => {
    expect(attributesOf(panelOf(render(false)), "a").map((link) => link.href)).toEqual(["/inside"]);
  });
});

describe("AC3 (issue 159) — MenuGroup's active marker", () => {
  it("AC3: active, its <summary> carries data-active", () => {
    const summaries = attributesOf(render(true), "summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveProperty("data-active");
  });

  it("AC3: not active, nothing in it carries data-active", () => {
    const html = render(false);
    expect(attributesOf(html, "summary")).toHaveLength(1);
    expect(html).not.toMatch(/\bdata-active\b/);
  });
});
