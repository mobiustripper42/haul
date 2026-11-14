// Issue 55, AC1: the name the Supper Club page finds its product by, and the seed writes it under.
import { describe, expect, it } from "vitest";
import { cheapestChoices, isSoldOut, priceOfChoices, SUPPER_CLUB_PRODUCT_NAME, type ProductOptionType, type ProductWithOptions } from "./products.js";

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

describe("AC3 (issue 57) — isSoldOut, the one comparison of held spots with the cap", () => {
  it("AC3: held spots at the cap are sold out", () => {
    expect(isSoldOut({ cap: 50 }, 50)).toBe(true);
  });

  it("AC3: held spots past the cap are sold out, as a lowered cap leaves them", () => {
    expect(isSoldOut({ cap: 30 }, 50)).toBe(true);
  });

  it("AC3: one spot short of the cap is not, which guards the two above", () => {
    expect(isSoldOut({ cap: 50 }, 49)).toBe(false);
  });
});

// Issue 141: the menu page's join panel, "{price} for {size}": the cheapest option of each type, and the name of the
// cheapest option of the first type that is not the menu type. The page takes one case through it.
describe("AC7 (issue 141) — cheapestChoices", () => {
  // The cheaper option of each type sits second, so position order alone never finds it.
  const SIZE: ProductOptionType = {
    id: "size",
    name: "How many people?",
    position: 1,
    menuTexts: false,
    options: [
      { id: "four", name: "Portioned for 4", priceCents: 7400, position: 1 },
      { id: "two", name: "Portioned for 2", priceCents: 4200, position: 2 },
    ],
  };
  const MENU: ProductOptionType = {
    id: "menu",
    name: "Which menu?",
    position: 2,
    menuTexts: true,
    options: [
      { id: "vegan", name: "Vegan", priceCents: 250, position: 1 },
      { id: "standard", name: "Standard", priceCents: 0, position: 2 },
    ],
  };
  const of = (optionTypes: ProductOptionType[]): ProductWithOptions => ({
    id: "product",
    name: "Supper Club",
    cap: 50,
    firstPickupDate: "2027-01-03",
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes,
  });

  it("AC7: the choices are the cheapest option of each type, and the size is the size type's cheapest option's name", () => {
    expect(cheapestChoices(of([SIZE, MENU]))).toEqual({ choices: { size: "two", menu: "standard" }, sizeName: "Portioned for 2" });
  });

  it("AC7: the choices' price is the panel's price, through priceOfChoices", () => {
    const product = of([SIZE, MENU]);
    expect(priceOfChoices(product, cheapestChoices(product).choices)).toBe(4200);
  });

  it("AC7: with the menu type first, the size is still the first type that is not the menu type", () => {
    const menuFirst = of([
      { ...MENU, position: 1 },
      { ...SIZE, position: 2 },
    ]);
    expect(cheapestChoices(menuFirst).sizeName).toBe("Portioned for 2");
  });

  it("AC7: with no type marked menuTexts, the size is the first type's cheapest option", () => {
    expect(cheapestChoices(of([SIZE, { ...MENU, menuTexts: false }])).sizeName).toBe("Portioned for 2");
  });

  it("AC7: a product whose only type is the menu type has no size: null", () => {
    expect(cheapestChoices(of([MENU]))).toEqual({ choices: { menu: "standard" }, sizeName: null });
  });
});
