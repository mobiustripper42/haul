// Issue 55, AC17: Select, the "Language for emails" field on Create Account.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, textsOf, utilitiesOf } from "../../app/screen-test-helpers";
import { Select } from "./select";

const render = (defaultValue = "es") =>
  renderToStaticMarkup(
    createElement(Select, {
      id: "language",
      name: "language",
      options: [
        { value: "en", label: "English" },
        { value: "es", label: "Español" },
      ],
      defaultValue,
    }),
  );

describe("AC17 — Select", () => {
  it("AC17: renders one select with its id and name", () => {
    expect(attributesOf(render(), "select")).toEqual([expect.objectContaining({ id: "language", name: "language" })]);
  });

  it("AC17: renders one option per entry, in order, each with its value and label", () => {
    const html = render();
    expect(attributesOf(html, "option").map((option) => option.value)).toEqual(["en", "es"]);
    expect(textsOf(html)).toEqual(["English", "Español"]);
  });

  it.each(["en", "es"])("AC17: with defaultValue %j only that option is selected", (defaultValue) => {
    const selected = attributesOf(render(defaultValue), "option").filter((option) => "selected" in option);
    expect(selected.map((option) => option.value)).toEqual([defaultValue]);
  });

  it("AC17: it sits at the 40px field height", () => {
    const [select] = attributesOf(render(), "select");
    expect(utilitiesOf(select?.class).some((utility) => /(^|-)h-field$/.test(utility))).toBe(true);
  });
});
