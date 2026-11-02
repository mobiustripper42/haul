// Issue 38, AC2: Card renders the card the screens hand-wrote (app/sign-in/page.tsx:21).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalMarkup } from "../../app/screen-test-helpers";
import { Card } from "./card";

describe("AC2 — Card", () => {
  it('AC2: renders <section class="card"> around its children, and nothing else', () => {
    const html = renderToStaticMarkup(createElement(Card, null, createElement("h1", null, "one"), createElement("p", null, "two")));
    expect(normalMarkup(html)).toBe(normalMarkup('<section class="card"><h1>one</h1><p>two</p></section>'));
  });
});
