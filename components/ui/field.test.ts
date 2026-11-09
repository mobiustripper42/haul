// Issue 38, AC4: Field renders the labelled field the screens hand-wrote (app/sign-in/page.tsx:34-39).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { blocksInsideParagraphs, normalMarkup, textsOf } from "../../app/screen-test-helpers";
import { Field } from "./field";
import { Hint } from "./hint";

describe("AC4 — Field", () => {
  it.each([
    ["email", "Email"],
    ["code", "6-digit code"],
  ])('AC4: with htmlFor %j renders a <p> holding <label for> with its label, then its children', (htmlFor, label) => {
    const html = renderToStaticMarkup(createElement(Field, { label, htmlFor, children: createElement("input", { id: htmlFor }) }));
    expect(normalMarkup(html)).toBe(
      normalMarkup(`<p><label for="${htmlFor}" class="mb-2 block text-field-label">${label}</label><input id="${htmlFor}"/></p>`),
    );
  });
});

// Issue 55: `help`, rendered through Hint. Field is called with the new prop, as the spec shapes it.
describe("AC17 (issue 55) — Field's help", () => {
  const HELP = "So the farm can reach you.";
  const render = () =>
    renderToStaticMarkup(createElement(Field, { label: "Phone", htmlFor: "phone", help: HELP, children: createElement("input", { id: "phone" }) }));

  it("AC17, issue 84: with help it renders Hint, with the id <htmlFor>-help, set below its children", () => {
    const hint = renderToStaticMarkup(createElement(Hint, { id: "phone-help", below: true, children: HELP }));
    const html = render();
    expect(textsOf(html)).toEqual(["Phone", HELP]);
    expect(normalMarkup(html)).toBe(
      normalMarkup(`<p><label for="phone" class="mb-2 block text-field-label">Phone</label><input id="phone"/>${hint}</p>`),
    );
  });

  it("AC17: the help line is no block inside Field's <p>, which a browser would close at it", () => {
    const html = render();
    expect(textsOf(html)).toContain(HELP);
    expect(blocksInsideParagraphs(html)).toEqual([]);
  });
});
