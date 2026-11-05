// Issue 55, AC17: FieldError, the danger line under a failing field (AC4).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { screenMarkup, textsOf, utilitiesOf } from "../../app/screen-test-helpers";
import { FieldError } from "./field-error";

const render = () => renderToStaticMarkup(createElement(FieldError, { id: "email-error", children: "Enter your phone number." }));

const root = (html: string) => /^<(\w+)\b([^>]*)>/.exec(screenMarkup(html));

describe("AC17 — FieldError", () => {
  it("AC17: renders its children, and only them", () => {
    expect(textsOf(render())).toEqual(["Enter your phone number."]);
  });

  it("AC17: carries its id, for the input's aria-describedby", () => {
    expect(root(render())?.[2] ?? "").toContain('id="email-error"');
  });

  it("AC17: is the danger line", () => {
    const classes = /class="([^"]*)"/.exec(root(render())?.[2] ?? "")?.[1];
    expect(utilitiesOf(classes)).toContain("text-danger");
  });
});
