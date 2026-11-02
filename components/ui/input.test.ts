// Issue 38, AC5: Input renders the text field the screens hand-wrote (app/sign-in/page.tsx:38,
// app/sign-in/code/page.tsx:34-45). AC9 checks its types in components/ui/types.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalMarkup } from "../../app/screen-test-helpers";
import { Input } from "./input";

// Every attribute the two screens give their fields, and a few they do not, together.
const ATTRIBUTES = {
  id: "code",
  name: "code",
  type: "text",
  inputMode: "numeric",
  autoComplete: "one-time-code",
  pattern: "[0-9]*",
  maxLength: 6,
  required: true,
  autoFocus: true,
  "aria-invalid": true,
  placeholder: "",
  defaultValue: "12",
  disabled: true,
  "data-probe": "kept",
} as const;

const render = (props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(Input, props as Parameters<typeof Input>[0]));

describe("AC5 — Input", () => {
  it('AC5: renders <input class="field">, and nothing else', () => {
    expect(normalMarkup(render({}))).toBe(normalMarkup('<input class="field"/>'));
  });

  it('AC5: with code renders <input class="field field-code">', () => {
    expect(normalMarkup(render({ code: true }))).toBe(normalMarkup('<input class="field field-code"/>'));
  });

  it("AC5: passes through every attribute it is given, as a raw <input> renders them", () => {
    const expected = renderToStaticMarkup(createElement("input", { ...ATTRIBUTES, className: "field" }));
    expect(normalMarkup(render(ATTRIBUTES))).toBe(normalMarkup(expected));
  });

  it("AC5: with code, passes through every attribute beside field field-code", () => {
    const expected = renderToStaticMarkup(createElement("input", { ...ATTRIBUTES, className: "field field-code" }));
    expect(normalMarkup(render({ ...ATTRIBUTES, code: true }))).toBe(normalMarkup(expected));
  });

  it("AC5: the email field the sign-in screen draws renders as it did by hand", () => {
    const html = render({ id: "email", name: "email", type: "email", autoComplete: "email", required: true });
    expect(normalMarkup(html)).toBe(
      normalMarkup('<input id="email" type="email" autoComplete="email" required="" class="field" name="email"/>'),
    );
  });
});
