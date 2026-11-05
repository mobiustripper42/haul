import type { ProductWithOptions } from "./products.js";

/**
 * Each option type's choice (option type id → option id) from a query: the query's value when it is one
 * of that type's options, else the type's first option. An array value takes its first entry. Keys that
 * name no option type are dropped, and the result runs in the product's option type order.
 */
export function resolveChoices(
  product: ProductWithOptions,
  query: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const choices: Record<string, string> = {};
  for (const type of product.optionTypes) {
    const raw = query[type.id];
    const asked = Array.isArray(raw) ? raw[0] : raw;
    const picked = type.options.find((option) => option.id === asked) ?? type.options[0];
    if (picked) choices[type.id] = picked.id;
  }
  return choices;
}

/** The choices as a query string, in the record's key insertion order, with no leading `?`. */
export function choicesQuery(choices: Record<string, string>): string {
  return new URLSearchParams(Object.entries(choices)).toString();
}
