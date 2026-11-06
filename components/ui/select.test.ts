// Issue 55, AC17: Select, the "Language for emails" field on Create Account.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { attributesOf, normalMarkup, textsOf, utilitiesOf } from "../../app/screen-test-helpers";
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

// Issue 59: Sort by needs a select that says when it changes. AC12 itself is by hand; this is the seam it stands on.
describe("AC12 (issue 59) — Select's onChange", () => {
  const props = {
    id: "sort",
    name: "sort",
    options: [
      { value: "name", label: "Name" },
      { value: "joined", label: "Joined, newest first" },
    ],
    defaultValue: "name",
  };

  it("AC12 (issue 59): a change reaches the onChange it was given", () => {
    const onChange = vi.fn();
    const select = Select({ ...props, onChange });
    (select.props as { onChange?: (event: unknown) => void }).onChange?.({ target: { value: "joined" }, currentTarget: { value: "joined" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("AC12 (issue 59): with no onChange it renders exactly as before", () => {
    expect(normalMarkup(renderToStaticMarkup(createElement(Select, props)))).toBe(
      normalMarkup(
        '<select id="sort" name="sort" class="field"><option value="name" selected="">Name</option><option value="joined">Joined, newest first</option></select>',
      ),
    );
  });
});
