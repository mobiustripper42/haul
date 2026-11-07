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

/**
 * The sum of the picked options' prices, in cents (docs/SPEC.md §7.1). `choices` maps an option type id to
 * an option id; a type with no pick, or a pick that is not its option, adds nothing.
 */
export function priceOfChoices(product: ProductWithOptions, choices: Record<string, string>): number {
  let total = 0;
  for (const type of product.optionTypes) {
    total += type.options.find((option) => option.id === choices[type.id])?.priceCents ?? 0;
  }
  return total;
}

/** The one comparison of held spots with the cap: a cap lowered below the count still reads as sold out. */
export function isSoldOut(product: { cap: number }, held: number): boolean {
  return held >= product.cap;
}

/** The Supper Club product. It is seeded data, so a database without it is broken, not empty. */
export async function requireSupperClub(repo: Repository): Promise<ProductWithOptions> {
  const product = await repo.findProductByName(SUPPER_CLUB_PRODUCT_NAME);
  if (!product) throw new Error(`The product "${SUPPER_CLUB_PRODUCT_NAME}" is not in the database`);
  return product;
}
