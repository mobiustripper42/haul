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
