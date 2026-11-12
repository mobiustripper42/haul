// Issue 38, AC7 and AC8: Button renders the buttons and the back link the screens hand-wrote
// (app/sign-in/page.tsx:40, app/sign-in/code/page.tsx:18 and :53). AC9 checks its types in
// components/ui/types.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, normalMarkup, utilitiesOf } from "../../app/screen-test-helpers";
import { Button, type ButtonKind, type ButtonProps } from "./button";

const KINDS: ButtonKind[] = ["primary", "secondary", "quiet"];

// The props are spread in as data; AC9, not this file, holds what TypeScript accepts.
const render = (props: Record<string, unknown>, text = "Go"): string =>
  renderToStaticMarkup(createElement(Button, { ...props, children: text } as unknown as ButtonProps));

describe("AC7 — Button", () => {
  it.each(KINDS)('AC7: kind %s renders <button class="btn-<kind>"> around its children, and adds no attribute — no default type', (kind) => {
    expect(normalMarkup(render({ kind }))).toBe(normalMarkup(`<button class="btn-${kind}">Go</button>`));
  });

  it.each([
    ["full", "btn-primary w-full", { full: true }],
    ["flush", "btn-primary btn-flush", { flush: true }],
    ["full and flush", "btn-primary w-full btn-flush", { full: true, flush: true }],
    ["full and flush, given flush first", "btn-primary w-full btn-flush", { flush: true, full: true }],
  ])("AC7: %s gives the class %j, in that order after the kind", (_what, cls, extra) => {
    expect(normalMarkup(render({ kind: "primary", ...extra }))).toBe(normalMarkup(`<button class="${cls}">Go</button>`));
  });

  it.each([
    ['flush "end"', "btn-quiet btn-flush-end", { flush: "end" }, "-mr-2"],
    ['flush "end-narrow"', "btn-quiet btn-flush-end-narrow", { flush: "end-narrow" }, "max-lg:-mr-2"],
  ])("issue 84: %s gives the class %j, which pulls the text flush with the right edge", (_what, cls, extra, pull) => {
    expect(normalMarkup(render({ kind: "quiet", ...extra }))).toBe(normalMarkup(`<button class="${cls}">Go</button>`));
    expect(utilitiesOf(cls)).toContain(pull);
  });

  it("AC7: full={false} and flush={false} add nothing", () => {
    expect(normalMarkup(render({ kind: "quiet", full: false, flush: false }))).toBe(normalMarkup('<button class="btn-quiet">Go</button>'));
  });

  it("AC7: passes through every attribute it is given, as a raw <button> renders them", () => {
    const attributes = {
      type: "submit",
      name: "language",
      value: "es",
      lang: "es",
      "aria-current": "true",
      "aria-label": "Español",
      id: "lang-es",
      form: "switch",
      disabled: true,
      "data-probe": "kept",
    } as const;
    const expected = renderToStaticMarkup(createElement("button", { ...attributes, className: "btn-quiet" }, "Español"));
    expect(normalMarkup(render({ kind: "quiet", ...attributes }, "Español"))).toBe(normalMarkup(expected));
  });

  it("AC7: the sign-in screen's submit button renders as it did by hand", () => {
    expect(normalMarkup(render({ kind: "primary", full: true, type: "submit" }, "Email me a code"))).toBe(
      normalMarkup('<button type="submit" class="btn-primary w-full">Email me a code</button>'),
    );
  });
});

describe("AC8 — Button with href", () => {
  it.each(KINDS)('AC8: kind %s with href renders <a href class="btn-<kind>"> around its children', (kind) => {
    expect(normalMarkup(render({ kind, href: "/sign-in" }))).toBe(normalMarkup(`<a href="/sign-in" class="btn-${kind}">Go</a>`));
  });

  it.each([
    ["back", "btn-quiet back-link", { back: true }],
    ["full", "btn-quiet w-full", { full: true }],
    ["flush", "btn-quiet btn-flush", { flush: true }],
    ["back and flush", "btn-quiet back-link btn-flush", { back: true, flush: true }],
    ["back, full and flush", "btn-quiet back-link w-full btn-flush", { flush: true, full: true, back: true }],
  ])("AC8: with href, %s gives the class %j — back-link straight after the kind", (_what, cls, extra) => {
    expect(normalMarkup(render({ kind: "quiet", href: "/sign-in", ...extra }))).toBe(normalMarkup(`<a href="/sign-in" class="${cls}">Go</a>`));
  });

  it("AC8: the code screen's back link renders as it did by hand", () => {
    expect(normalMarkup(render({ kind: "quiet", href: "/sign-in", back: true, flush: true }, "Use a different email"))).toBe(
      normalMarkup('<a href="/sign-in" class="btn-quiet back-link btn-flush">Use a different email</a>'),
    );
  });
});

// Issue 156: "Keep the old email" drops the pending change, so it posts; a submit button takes the back arrow too.
describe("AC14 (issue 156) — Button's button form, back", () => {
  it("AC14: a submit Button with back gets back-link straight after the kind, as the link does, and no back attribute", () => {
    expect(normalMarkup(render({ kind: "quiet", type: "submit", back: true, flush: true }, "Keep the old email"))).toBe(
      normalMarkup('<button type="submit" class="btn-quiet back-link btn-flush">Keep the old email</button>'),
    );
  });
});

// Issue 77: the link form's `current`. The fill's colour is read in a browser, e2e/supper-club.spec.ts.
describe("AC5 (issue 77) — Button's link form, current", () => {
  it('AC5: current adds aria-current="page" to the link, keeping its kind and href', () => {
    const [link] = attributesOf(render({ kind: "secondary", href: "/supper-club/sign-in", current: true }), "a");
    expect(link).toMatchObject({ href: "/supper-club/sign-in", "aria-current": "page" });
    expect(link?.class).toContain("btn-secondary");
  });
});
