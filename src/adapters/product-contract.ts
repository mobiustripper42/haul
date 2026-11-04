/**
 * `findProductByName`'s contract (issue 55, AC1), a suite of its own so `runRepositoryContract`'s
 * callers are not edited. Run against both adapters, as that one is (DEC-010).
 *
 * Not a test file itself: it registers describe/it blocks, and each adapter's test file calls it.
 * `addProduct` stores a product through whatever the adapter has for that: the fake's test seam, or
 * rows inserted by hand. `reset`, when given, runs before every test and before `make`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "../ports/repository.js";
import type { ProductInput, ProductWithOptions } from "../products.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SETTINGS = { cap: 50, firstPickupDate: "2027-01-03", cutoffWeekday: 1, cutoffTime: "24:00:00" };
const OPTION = { name: "One", priceCents: 0, position: 1 };

const BOX: ProductInput = {
  name: "Box",
  ...SETTINGS,
  optionTypes: [
    {
      name: "Size",
      position: 1,
      options: [
        { name: "2 person", priceCents: 5000, position: 1 },
        { name: "3–4 person", priceCents: 8000, position: 2 },
      ],
    },
    {
      name: "Preference",
      position: 2,
      options: [
        { name: "Standard", priceCents: 0, position: 1 },
        { name: "Vegan", priceCents: 0, position: 2 },
      ],
    },
  ],
};

export function runProductContract(
  name: string,
  make: () => Promise<Repository>,
  addProduct: (input: ProductInput) => Promise<ProductWithOptions>,
  reset?: () => Promise<void>,
): void {
  describe(`Product contract — ${name}`, () => {
    let repo: Repository;

    beforeEach(async () => {
      if (reset) await reset();
      repo = await make();
    });

    it("AC1: an unknown name is null", async () => {
      await addProduct(BOX);
      expect(await repo.findProductByName("Crate")).toBeNull();
    });

    it("AC1: it returns the product's settings, firstPickupDate as YYYY-MM-DD and cutoffTime as HH:MM:SS", async () => {
      await addProduct(BOX);
      expect(await repo.findProductByName("Box")).toMatchObject({ name: "Box", ...SETTINGS });
    });

    it("AC1: every option type and option comes back with its fields, and every id is a UUID", async () => {
      await addProduct(BOX);
      const found = await repo.findProductByName("Box");
      const withoutIds = found?.optionTypes.map(({ name: typeName, position, options }) => ({
        name: typeName,
        position,
        options: options.map((option) => ({ name: option.name, priceCents: option.priceCents, position: option.position })),
      }));
      expect(withoutIds).toEqual(BOX.optionTypes);
      const ids = [found?.id, ...(found?.optionTypes ?? []).flatMap((type) => [type.id, ...type.options.map((option) => option.id)])];
      expect(ids).toHaveLength(7);
      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ids).size).toBe(7);
    });

    it("AC1: addProduct returns the product as findProductByName does", async () => {
      const added = await addProduct(BOX);
      expect(added.name).toBe("Box");
      expect(await repo.findProductByName("Box")).toEqual(added);
    });

    it("AC1: option types come back ordered by position, then name, whatever order they were stored in", async () => {
      await addProduct({
        name: "Box",
        ...SETTINGS,
        optionTypes: [
          { name: "Zebra", position: 1, options: [OPTION] },
          { name: "Apple", position: 2, options: [OPTION] },
          { name: "Mango", position: 1, options: [OPTION] },
        ],
      });
      expect((await repo.findProductByName("Box"))?.optionTypes.map((type) => type.name)).toEqual(["Mango", "Zebra", "Apple"]);
    });

    it("AC1: options come back ordered by position, then name, whatever order they were stored in", async () => {
      await addProduct({
        name: "Box",
        ...SETTINGS,
        optionTypes: [
          {
            name: "Size",
            position: 1,
            options: [
              { name: "Zebra", priceCents: 0, position: 1 },
              { name: "Apple", priceCents: 0, position: 2 },
              { name: "Mango", priceCents: 0, position: 1 },
            ],
          },
        ],
      });
      expect((await repo.findProductByName("Box"))?.optionTypes[0]?.options.map((option) => option.name)).toEqual(["Mango", "Zebra", "Apple"]);
    });

    it("AC1: another product's option types and options are not returned", async () => {
      await addProduct(BOX);
      await addProduct({ name: "Crate", ...SETTINGS, optionTypes: [{ name: "Weight", position: 1, options: [OPTION] }] });
      expect((await repo.findProductByName("Crate"))?.optionTypes.map((type) => type.name)).toEqual(["Weight"]);
      expect((await repo.findProductByName("Box"))?.optionTypes.map((type) => type.name)).toEqual(["Size", "Preference"]);
    });

    it("AC1: a product with no option types is found, with none", async () => {
      await addProduct({ name: "Bare", ...SETTINGS, optionTypes: [] });
      expect(await repo.findProductByName("Bare")).toMatchObject({ name: "Bare", optionTypes: [] });
    });
  });
}
