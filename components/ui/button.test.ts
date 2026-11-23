// Issue 38, AC7 and AC8: Button renders the buttons and the back link the screens hand-wrote
// (app/sign-in/page.tsx:40, app/sign-in/code/page.tsx:18 and :53). AC9 checks its types in
// components/ui/types.test.ts.
// Issue 245, AC1 and AC3: an in-app href is drawn by next/link, any other href, and a download, by a plain <a>. next/link
// is mocked as the real Link wrapped in a spy, so the markup is what the real one writes and the spy records what it was given.
// Issue 240, AC13: a download link carries no `download` attribute, so a turned-away download opens the sign-in page. What a tapped
// button or link shows is the browser's (e2e/tap-feedback.spec.ts); these hold the markup at rest, which it does not change.
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attributesOf, normalMarkup, utilitiesOf } from "../../app/screen-test-helpers";
import { Button, type ButtonKind, type ButtonProps } from "./button";

/** The props each next/link was rendered with, in order. */
const nextLinks = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<{ default: ComponentType<Record<string, unknown>> }>();
  const { createElement: create } = await import("react");
  const Real = actual.default;
  return {
    ...actual,
    default: function SpiedLink(props: Record<string, unknown>) {
      nextLinks.push(props);
      return create(Real, props);
    },
  };
});

beforeEach(() => {
  nextLinks.length = 0;
});

const KINDS: ButtonKind[] = ["primary", "secondary", "strong", "quiet"];

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

// Issue 245: which links are next/link is isInAppHref's (in-app-href.test.ts); here, one in-app href and one other.
describe("AC1 (issue 245) — Button with an in-app href is a next/link", () => {
  it("AC1: it renders one next/link to the href, with today's class, aria-current and children", () => {
    const html = render({ kind: "menu", href: "/admin/menus", full: true, nowrap: true, current: true }, "Menus");
    expect(nextLinks).toHaveLength(1);
    expect(nextLinks[0]).toMatchObject({ href: "/admin/menus", className: "btn-menu w-full btn-nowrap", "aria-current": "page" });
    expect(normalMarkup(html)).toBe(normalMarkup('<a href="/admin/menus" class="btn-menu w-full btn-nowrap" aria-current="page">Menus</a>'));
  });

  it("AC1: without current, the next/link carries no aria-current, as today's <a> carries none", () => {
    const html = render({ kind: "quiet", href: "/sign-in", back: true, flush: true });
    expect(nextLinks).toHaveLength(1);
    expect(nextLinks[0]).toMatchObject({ href: "/sign-in", className: "btn-quiet back-link btn-flush" });
    expect(nextLinks[0]?.["aria-current"]).toBeUndefined();
    expect(normalMarkup(html)).toBe(normalMarkup('<a href="/sign-in" class="btn-quiet back-link btn-flush">Go</a>'));
  });
});

describe("AC3 (issue 245) — Button's other links are a plain <a>", () => {
  it("AC3: a Button whose href is not in-app renders a plain <a> exactly as today, and no next/link", () => {
    const html = render({ kind: "secondary", href: "mailto:farm@example.com" });
    expect(nextLinks).toEqual([]);
    expect(normalMarkup(html)).toBe(normalMarkup('<a href="mailto:farm@example.com" class="btn-secondary">Go</a>'));
  });

  it("AC3, AC13 (issue 240): a Button link given download renders a plain <a> with no download attribute and no ring, though its href is in-app", () => {
    const html = render({ kind: "secondary", href: "/admin/members.csv", download: true });
    expect(nextLinks).toEqual([]);
    expect(normalMarkup(html)).toBe(normalMarkup('<a href="/admin/members.csv" class="btn-secondary">Go</a>'));
  });

  it("AC13 (issue 240): a Button link given download renders the same plain <a> when its href is not in-app", () => {
    const html = render({ kind: "secondary", href: "https://example.com/members.csv", download: true });
    expect(nextLinks).toEqual([]);
    expect(normalMarkup(html)).toBe(normalMarkup('<a href="https://example.com/members.csv" class="btn-secondary">Go</a>'));
  });
});
