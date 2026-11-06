// Issue 56, AC1 (hand walk, 2026-11-06): Square's card form measures 97px at this width, so the box around
// it grows to fit it and never covers the hint below. Square's form exists only with Square's script in a
// browser, and e2e draws the test field in its place (DEC-023), so this reads the box's classes, as
// components/ui/card.test.ts does. The box drawn around the real form is AC15, by hand.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { screenMarkup, utilitiesOf } from "../../app/screen-test-helpers";
import { CardEntry } from "./card-entry";

/** The class of the box Square attaches its form to: the one element with nothing in it. */
function cardBoxClass(): string | undefined {
  const html = renderToStaticMarkup(
    createElement(CardEntry, {
      label: "Card",
      hint: "Secure card entry by Square.",
      testLabel: "Test card",
      failedText: "The card form didn't load.",
      testMode: false,
      applicationId: "sandbox-application",
      locationId: "LOCATION",
      amountCents: 5000,
      billing: { email: "member@example.com" },
    }),
  );
  return /<div\b[^>]*\bclass="([^"]*)"[^>]*><\/div>/.exec(screenMarkup(html))?.[1];
}

describe("AC1 (issue 56) — CardEntry's box", () => {
  it("AC1: the box around Square's form has no fixed height, keeps the field's look, and the text fields stay 40px", () => {
    const utilities = utilitiesOf(cardBoxClass());
    expect(utilities).toEqual(expect.arrayContaining(["rounded-sm", "border", "border-border", "bg-surface"]));
    expect(utilitiesOf("field")).toContain("h-field");

    // The last height named is the one that holds, whether a class replaces `.field`'s or leaves it out.
    expect(utilities.filter((utility) => utility.startsWith("h-")).at(-1) ?? "h-auto").toBe("h-auto");
  });
});
