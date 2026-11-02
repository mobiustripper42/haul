// Issue 38, AC4: Field renders the labelled field the screens hand-wrote (app/sign-in/page.tsx:34-39).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalMarkup } from "../../app/screen-test-helpers";
import { Field } from "./field";

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
