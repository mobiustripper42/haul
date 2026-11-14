import type { ReactElement } from "react";
import type { Translator } from "@core/i18n.js";
import { formatUsdWhole } from "@core/money.js";
import type { ProductWithOptions } from "@core/products.js";
import { OptionPicker } from "../components/ui/option-picker";

/**
 * An `OptionPicker` per option type of the product, so an option type added in data adds a picker: the signup page
 * and the Upcoming weeks meal card both draw them here. `selected` is option type id → option id. Both call this as a
 * function, so the pickers stay in the tree the page returns.
 */
export function MealPickers({ product, selected, t }: { product: ProductWithOptions; selected: Record<string, string>; t: Translator }): ReactElement {
  return (
    <>
      {product.optionTypes.map((type, index) => (
        <OptionPicker
          key={type.id}
          name={type.id}
          legend={t("supperClub.pickerLegend", { n: index + 1, name: type.name })}
          options={type.options.map((option) => ({
            value: option.id,
            label: option.name,
            ...(option.priceCents > 0 ? { detail: t("supperClub.price", { price: formatUsdWhole(option.priceCents) }) } : {}),
          }))}
          selected={selected[type.id] ?? ""}
        />
      ))}
    </>
  );
}
