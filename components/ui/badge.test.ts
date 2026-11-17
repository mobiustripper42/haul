// Issue 145, AC1: Badge's declined kind, the account home's "Card declined" in the Active badge's slot. Its word is
// the screen's (app/account/page.test.ts); here, its look: the danger pairing, and an icon so it reads without colour.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, textsOf, utilitiesOf } from "../../app/screen-test-helpers";
import { Badge } from "./badge";

const html = () => renderToStaticMarkup(createElement(Badge, { kind: "declined", children: "Card declined" }));

describe("AC1 (issue 145) — Badge's declined kind", () => {
  it("AC1: it draws its word beside an icon hidden from screen readers, so it reads without colour", () => {
    expect(textsOf(html())).toEqual(["Card declined"]);
    expect(attributesOf(html(), "svg").map((svg) => svg["aria-hidden"])).toEqual(["true"]);
  });

  it("AC1: it is the danger text on the danger-soft fill", () => {
    expect(utilitiesOf(attributesOf(html(), "span")[0]?.class)).toEqual(expect.arrayContaining(["bg-danger-soft", "text-danger"]));
  });
});
