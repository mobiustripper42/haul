// Issue 63, AC1: BulletList, the one home for the list look the Supper Club page wrote by hand
// (DEC-024). That the page now uses it is app/supper-club/join-page.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, screenMarkup, utilitiesOf } from "../../app/screen-test-helpers";
import { BulletList } from "./bullet-list";

const html = () => renderToStaticMarkup(createElement(BulletList, { items: ["One", "Two", "Three"] }));

describe("AC1 — BulletList", () => {
  it("AC1: it is one list with one item per entry, in order", () => {
    expect(screenMarkup(html()).match(/<li\b[^>]*>[^<]*<\/li>/g)?.map((item) => item.replace(/<[^>]*>/g, ""))).toEqual(["One", "Two", "Three"]);
    expect(attributesOf(html(), "ul")).toHaveLength(1);
  });

  it("AC1: it has the look at the Supper Club page: discs, 4px apart, 20px in", () => {
    expect(utilitiesOf(attributesOf(html(), "ul")[0]?.class)).toEqual(expect.arrayContaining(["flex", "list-disc", "flex-col", "gap-1", "pl-5"]));
  });
});
