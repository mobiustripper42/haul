import type { ChangeEvent } from "react";

/**
 * A select at the field height, in the text field's look. The caller's `Field` label names it with the same
 * `id`. Uncontrolled; an `onChange` hears each pick (issue 59's "Sort by").
 */
export function Select({
  id,
  name,
  options,
  defaultValue,
  onChange,
}: {
  id: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <select id={id} name={name} defaultValue={defaultValue} onChange={onChange} className="field">
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
