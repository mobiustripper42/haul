// Issue 55, AC2 and AC14: the one home of the choices query. The product is written out, ordered as
// findProductByName orders it; that ordering is held by src/adapters/product-contract.ts.
import { describe, expect, it } from "vitest";
import { choicesQuery, resolveChoices } from "./choices.js";
import type { ProductWithOptions } from "./products.js";

const PRODUCT: ProductWithOptions = {
  id: "box",
  name: "Box",
  cap: 5,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes: [
    {
      id: "size",
      name: "Size",
      position: 1,
      options: [
        { id: "two", name: "2 person", priceCents: 5000, position: 1 },
        { id: "four", name: "3–4 person", priceCents: 8000, position: 2 },
      ],
    },
    {
      id: "menu",
      name: "Preference",
      position: 2,
      options: [
        { id: "standard", name: "Standard", priceCents: 0, position: 1 },
        { id: "vegan", name: "Vegan", priceCents: 0, position: 2 },
      ],
    },
  ],
};

describe("AC14 — resolveChoices", () => {
  it("AC14: an empty query resolves each option type to its first option", () => {
    expect(resolveChoices(PRODUCT, {})).toEqual({ size: "two", menu: "standard" });
  });

  it("AC14: a choice that is one of its type's options is kept", () => {
    expect(resolveChoices(PRODUCT, { size: "four", menu: "vegan" })).toEqual({ size: "four", menu: "vegan" });
  });

  it("AC14: a choice that is no option at all resolves to the type's first option, and the other type's choice is kept", () => {
    expect(resolveChoices(PRODUCT, { size: "nonsense", menu: "vegan" })).toEqual({ size: "two", menu: "vegan" });
  });

  it("AC14: another type's option is not one of this type's options", () => {
    expect(resolveChoices(PRODUCT, { size: "vegan", menu: "four" })).toEqual({ size: "two", menu: "standard" });
  });

  it("AC14: an undefined value is missing", () => {
    expect(resolveChoices(PRODUCT, { size: undefined, menu: "vegan" })).toEqual({ size: "two", menu: "vegan" });
  });

  it("AC14: an array value takes its first entry", () => {
    expect(resolveChoices(PRODUCT, { size: ["four", "two"], menu: ["vegan"] })).toEqual({ size: "four", menu: "vegan" });
  });

  it("AC14: an array whose first entry is not an option falls back to the first option, not to a later entry", () => {
    expect(resolveChoices(PRODUCT, { size: ["nonsense", "four"] })).toEqual({ size: "two", menu: "standard" });
  });

  it("AC14: an empty array is missing", () => {
    expect(resolveChoices(PRODUCT, { size: [] })).toEqual({ size: "two", menu: "standard" });
  });

  it("AC14: a query key that names no option type is dropped", () => {
    expect(resolveChoices(PRODUCT, { next: "sign-in", evil: "//evil.com", size: "four" })).toEqual({ size: "four", menu: "standard" });
  });

  it("AC14: the keys run in the product's option type order, whatever the query's order", () => {
    expect(Object.keys(resolveChoices(PRODUCT, { menu: "vegan", size: "four" }))).toEqual(["size", "menu"]);
  });
});

describe("AC2 — choicesQuery", () => {
  it("AC2: joins the record's pairs, in its key insertion order, with no leading ?", () => {
    expect(choicesQuery({ size: "four", menu: "vegan" })).toBe("size=four&menu=vegan");
  });

  it("AC2: never sorts", () => {
    expect(choicesQuery({ zebra: "1", apple: "2" })).toBe("zebra=1&apple=2");
  });

  it("AC2: encodes as URLSearchParams does", () => {
    expect(choicesQuery({ "a b": "c&d" })).toBe(new URLSearchParams({ "a b": "c&d" }).toString());
  });

  it("AC2: the resolved choices of a shuffled query, with a stray key in it, make the product's own order and nothing else", () => {
    expect(choicesQuery(resolveChoices(PRODUCT, { evil: "x", menu: "vegan", size: "four" }))).toBe("size=four&menu=vegan");
  });
});
