// Issue 245, AC4: the header's wordmark, the farm's name over its byline, is a next/link. Issue 266: to the `href` it is
// given; which one the header gives it is app/site-header.test.ts's (AC18, and AC6 of issue 266). next/link is mocked as the real Link wrapped in a spy, so
// the markup is what the real one writes and the spy records what it was given.
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attributesOf, textsOf } from "../../app/screen-test-helpers";
import { Wordmark } from "./wordmark";

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

/** A destination no caller uses, so a fixed `/` cannot pass for it. */
const HREF = "/the-destination";

const render = () => renderToStaticMarkup(createElement(Wordmark, { name: "the-name", byline: "the-byline", href: HREF }));

describe("AC4 (issue 245) — Wordmark", () => {
  it("AC4: it is one next/link, to the href given", () => {
    render();
    expect(nextLinks.map((props) => props.href)).toEqual([HREF]);
  });

  it("AC4: the link to the href given holds the name, then the byline, and nothing else is a link", () => {
    const html = render();
    expect(attributesOf(html, "a").map((link) => link.href)).toEqual([HREF]);
    expect(textsOf(html)).toEqual(["the-name", "the-byline"]);
  });
});

// What it shows while its page is loading is the browser's (e2e/tap-feedback.spec.ts).
describe("AC10 (issue 240) — Wordmark at rest", () => {
  it("AC10: the link holds its two lines alone: no wrapper, no ring and no mark", () => {
    expect(render().replace(/ class="[^"]*"/g, "")).toBe(`<a href="${HREF}"><span>the-name</span><span>the-byline</span></a>`);
  });
});
