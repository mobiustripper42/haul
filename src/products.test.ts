// Issue 55, AC1: the name the Supper Club page finds its product by, and the seed writes it under.
import { describe, expect, it } from "vitest";
import { priceOfChoices, SUPPER_CLUB_PRODUCT_NAME, type ProductWithOptions } from "./products.js";

describe("AC1 — the Supper Club's product name", () => {
  it('AC1: SUPPER_CLUB_PRODUCT_NAME is "Supper Club"', () => {
    expect(SUPPER_CLUB_PRODUCT_NAME).toBe("Supper Club");
  });
});

describe("AC2 (issue 56) — the price of a pick", () => {
  const product: ProductWithOptions = {
    id: "product",
    name: "Supper Club",
    cap: 50,
    firstPickupDate: "2027-01-03",
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes: [
      {
        id: "size",
        name: "How many people?",
        position: 1,
        options: [
          { id: "two", name: "2 people", priceCents: 5000, position: 1 },
          { id: "four", name: "3–4 people", priceCents: 8000, position: 2 },
        ],
      },
      {
        id: "menu",
        name: "Which menu?",
        position: 2,
        options: [
          { id: "standard", name: "Standard", priceCents: 0, position: 1 },
          { id: "vegan", name: "Vegan", priceCents: 250, position: 2 },
        ],
      },
    ],
  };

  it("AC2: priceOfChoices is the sum of the picked options", () => {
    expect(priceOfChoices(product, { size: "four", menu: "vegan" })).toBe(8250);
  });

  it("AC2: another pick gives another sum", () => {
    expect(priceOfChoices(product, { size: "two", menu: "standard" })).toBe(5000);
  });
});
