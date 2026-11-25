// Issue 238, AC6: BoldValue draws the sentence `line(value)` with the value in bold. The line and value the account page
// passes are app/account/page.test.ts's; here, where the bold falls.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { screenMarkup } from "../../app/screen-test-helpers";
import { BoldValue } from "./bold-value";

/** The sentence as drawn, each `strong` written as [its text] and every other tag left out. */
const drawn = (line: (value: string) => string, value: string): string =>
  screenMarkup(
    renderToStaticMarkup(createElement(BoldValue, { line, value }))
      .replace(/<strong\b[^>]*>/g, "[")
      .replace(/<\/strong>/g, "]")
      .replace(/<[^>]*>/g, ""),
  );

describe("AC6 — BoldValue", () => {
  it.each<[string, (value: string) => string, string]>([
    ["in the middle", (value) => `Pending switch to ${value} starting March 7.`, "Pending switch to [2 people · Vegan] starting March 7."],
    ["at the start", (value) => `${value} is pending.`, "[2 people · Vegan] is pending."],
    ["at the end", (value) => `Pending: ${value}`, "Pending: [2 people · Vegan]"],
  ])("AC6: a value %s of the line is in strong, and the rest of the sentence outside it", (_where, line, sentence) => {
    expect(drawn(line, "2 people · Vegan")).toBe(sentence);
  });

  it.each<[string, (value: string) => string, string]>([
    ["before", (value) => `Standard menu, now: ${value}.`, "Standard menu, now: [Standard]."],
    ["after", (value) => `${value} is now the Standard menu.`, "[Standard] is now the Standard menu."],
  ])("AC6: a value whose words also occur %s it in the fixed text is bold once, in its own place", (_where, line, sentence) => {
    expect(drawn(line, "Standard")).toBe(sentence);
  });

  it("AC6: a sentence that does not hold the value is drawn plain", () => {
    expect(drawn(() => "Nothing is pending.", "2 people · Vegan")).toBe("Nothing is pending.");
  });
});
