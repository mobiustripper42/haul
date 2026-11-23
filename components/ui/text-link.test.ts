// Issue 63, AC6: TextLink, the inline link inside a sentence. A raw `<a>` reads as plain text (issue 44).
// Issue 245, AC2 and AC3: an in-app href with no newTab is drawn by next/link; any other href, and newTab, by a plain <a>.
// next/link is mocked as the real Link wrapped in a spy, so the markup is what the real one writes and the spy records
// what it was given.
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attributesOf, normalMarkup, textsOf, utilitiesOf } from "../../app/screen-test-helpers";
import { TextLink } from "./text-link";

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

// Issue 245: which links are next/link is isInAppHref's (in-app-href.test.ts); here, one in-app href, one other, and newTab.
const renderTo = (href: string, newTab?: boolean) => renderToStaticMarkup(createElement(TextLink, { href, ...(newTab ? { newTab } : {}), children: "Terms" }));

describe("AC2 (issue 245) — TextLink with an in-app href is a next/link", () => {
  it("AC2: with no newTab it renders one next/link to the href, with today's class", () => {
    const html = renderTo("/terms");
    expect(nextLinks).toHaveLength(1);
    expect(nextLinks[0]).toMatchObject({ href: "/terms", className: "text-teal underline", children: "Terms" });
    expect(normalMarkup(html)).toBe(normalMarkup('<a href="/terms" class="text-teal underline">Terms</a>'));
  });
});

describe("AC3 (issue 245) — TextLink's other links are a plain <a>", () => {
  it("AC3: a TextLink whose href is not in-app renders a plain <a> exactly as today, and no next/link", () => {
    const html = renderTo("https://squareup.com/legal");
    expect(nextLinks).toEqual([]);
    expect(normalMarkup(html)).toBe(normalMarkup('<a href="https://squareup.com/legal" class="text-teal underline">Terms</a>'));
  });

  it("AC3: a TextLink with an in-app href and newTab renders a plain <a> exactly as today, and no next/link", () => {
    const html = renderTo("/terms", true);
    expect(nextLinks).toEqual([]);
    expect(normalMarkup(html)).toBe(normalMarkup('<a href="/terms" class="text-teal underline" target="_blank" rel="noopener noreferrer">Terms</a>'));
  });
});
