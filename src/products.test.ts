// Issue 55, AC1: the name the Supper Club page finds its product by, and the seed writes it under.
import { describe, expect, it } from "vitest";
import { SUPPER_CLUB_PRODUCT_NAME } from "./products.js";

describe("AC1 — the Supper Club's product name", () => {
  it('AC1: SUPPER_CLUB_PRODUCT_NAME is "Supper Club"', () => {
    expect(SUPPER_CLUB_PRODUCT_NAME).toBe("Supper Club");
  });
});
