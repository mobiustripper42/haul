// Issue 159, AC4: MenuDrawer, the signed-in header's drawer below 1024px. It draws what it is given: `children`, then
// `foot` after them, and no link of its own. Which links and which Sign out the header gives it is
// app/site-header.test.ts's; how it opens and closes (AC8) is checked by hand.
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, screenMarkup } from "../../app/screen-test-helpers";
import { MenuDrawer } from "./menu-drawer";

const render = () =>
  screenMarkup(
    renderToStaticMarkup(
      createElement(MenuDrawer, {
        label: "Open",
        closeLabel: "Shut",
        heading: "Farm",
        children: createElement(Fragment, null, createElement("a", { href: "/one" }, "One"), createElement("a", { href: "/two" }, "Two")),
        foot: createElement("form", { "data-probe": "foot" }, createElement("button", { type: "submit" }, "Leave")),
      }),
    ),
  );

describe("AC4 (issue 159) — MenuDrawer", () => {
  it("AC4: it draws its children's links and no link of its own", () => {
    expect(attributesOf(render(), "a").map((link) => link.href)).toEqual(["/one", "/two"]);
  });

  it("AC4: the foot comes last, after every link", () => {
    const html = render();
    const foot = html.indexOf('data-probe="foot"');
    expect(foot).toBeGreaterThan(-1);
    expect(foot).toBeGreaterThan(html.lastIndexOf("<a "));
    expect(attributesOf(html.slice(foot), "a")).toEqual([]);
  });
});
