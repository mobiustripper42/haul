// Issue 63, AC6: TextLink, the inline link inside a sentence. A raw `<a>` reads as plain text (issue 44).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, textsOf, utilitiesOf } from "../../app/screen-test-helpers";
import { TextLink } from "./text-link";

const render = (newTab?: boolean) =>
  renderToStaticMarkup(createElement(TextLink, { href: "/terms", ...(newTab === undefined ? {} : { newTab }), children: "Terms" }));

describe("AC6 — TextLink", () => {
  it("AC6: it is a link to href around its children", () => {
    const html = render();
    expect(attributesOf(html, "a")[0]?.href).toBe("/terms");
    expect(textsOf(html)).toEqual(["Terms"]);
  });

  it("AC6: it is underlined and teal", () => {
    expect(utilitiesOf(attributesOf(render(), "a")[0]?.class)).toEqual(expect.arrayContaining(["underline", "text-teal"]));
  });

  it('AC6: newTab opens it in a new tab, with rel="noopener noreferrer"', () => {
    expect(attributesOf(render(true), "a")[0]).toMatchObject({ href: "/terms", target: "_blank", rel: "noopener noreferrer" });
  });

  it("AC6: without newTab it stays in this tab: no target and no rel", () => {
    const [link] = attributesOf(render(false), "a");
    expect(link?.href).toBe("/terms");
    expect(link).not.toHaveProperty("target");
    expect(link).not.toHaveProperty("rel");
  });
});
