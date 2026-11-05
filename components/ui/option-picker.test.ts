// Issue 55, AC17: OptionPicker renders one radio per option under a legend (AC1's pickers).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, screenMarkup, textsOf } from "../../app/screen-test-helpers";
import { OptionPicker } from "./option-picker";

const render = (selected = "four") =>
  renderToStaticMarkup(
    createElement(OptionPicker, {
      name: "size",
      legend: "1. Size",
      options: [
        { value: "two", label: "2 person", detail: "$50 a week" },
        { value: "four", label: "3–4 person" },
      ],
      selected,
    }),
  );

describe("AC17 — OptionPicker", () => {
  it("AC17: renders one fieldset that opens with its legend", () => {
    const html = render();
    expect(attributesOf(html, "fieldset")).toHaveLength(1);
    expect(screenMarkup(html)).toMatch(/<fieldset\b[^>]*>\s*<legend\b[^>]*>1\. Size<\/legend>/);
  });

  it("AC17: renders one radio per option, each with the picker's name and the option's value", () => {
    const radios = attributesOf(render(), "input");
    expect(radios.map(({ type, name, value }) => ({ type, name, value }))).toEqual([
      { type: "radio", name: "size", value: "two" },
      { type: "radio", name: "size", value: "four" },
    ]);
  });

  it.each(["two", "four"])("AC17: with selected %j only that radio is checked", (selected) => {
    const checked = attributesOf(render(selected), "input").filter((radio) => "checked" in radio);
    expect(checked.map((radio) => radio.value)).toEqual([selected]);
  });

  it("AC17: shows each option's label, and its detail line only when given", () => {
    expect(textsOf(render())).toEqual(["1. Size", "2 person", "$50 a week", "3–4 person"]);
  });

  it("AC17: every radio has a label of its own, by wrapping it or by for", () => {
    const html = render();
    const labels = [...screenMarkup(html).matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)];
    expect(labels).toHaveLength(2);
    for (const radio of attributesOf(html, "input")) {
      const labelled = labels.some(([, attributes = "", body = ""]) =>
        body.includes(`value="${radio.value}"`) || (radio.id !== undefined && attributes.includes(`for="${radio.id}"`)),
      );
      expect(labelled, `the radio ${radio.value} has no label`).toBe(true);
    }
  });
});
