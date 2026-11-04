// Issue 55, AC17: ButtonRow, the two buttons of the Supper Club's section 3. How it stacks on a phone
// is AC15's, by hand.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { screenMarkup, textsOf } from "../../app/screen-test-helpers";
import { Button } from "./button";
import { ButtonRow } from "./button-row";

const render = () =>
  renderToStaticMarkup(
    createElement(
      ButtonRow,
      null,
      createElement(Button, { kind: "primary", children: "Create an account" }),
      createElement(Button, { kind: "secondary", children: "Sign in" }),
    ),
  );

describe("AC17 — ButtonRow", () => {
  it("AC17: holds its buttons in the order given, primary first", () => {
    expect(textsOf(render())).toEqual(["Create an account", "Sign in"]);
  });

  it("AC17: wraps them in one element that carries the row's look", () => {
    expect(screenMarkup(render())).toMatch(/^<(\w+)\b[^>]*\bclass="[^"]+"[^>]*>\s*<button\b[\s\S]*<\/button>\s*<\/\1>$/);
  });
});
