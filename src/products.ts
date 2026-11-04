import type { Repository } from "./ports/repository.js";

export const SUPPER_CLUB_PRODUCT_NAME = "Supper Club";

export type ProductOption = { id: string; name: string; priceCents: number; position: number };

export type ProductOptionType = { id: string; name: string; position: number; options: ProductOption[] };

export type ProductWithOptions = {
  id: string;
  name: string;
  cap: number;
  firstPickupDate: string;
  cutoffWeekday: number;
  cutoffTime: string;
  optionTypes: ProductOptionType[];
};

/** `ProductWithOptions` with every `id` left out: the product's, its option types' and their options'. */
export type ProductInput = Omit<ProductWithOptions, "id" | "optionTypes"> & {
  optionTypes: Array<Omit<ProductOptionType, "id" | "options"> & { options: Array<Omit<ProductOption, "id">> }>;
};

/** The Supper Club product. It is seeded data, so a database without it is broken, not empty. */
export async function requireSupperClub(repo: Repository): Promise<ProductWithOptions> {
  const product = await repo.findProductByName(SUPPER_CLUB_PRODUCT_NAME);
  if (!product) throw new Error(`The product "${SUPPER_CLUB_PRODUCT_NAME}" is not in the database`);
  return product;
}
