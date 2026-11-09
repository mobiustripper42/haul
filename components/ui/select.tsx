import type { ChangeEvent } from "react";

/**
 * A select at the field height, in the text field's look. The caller's `Field` label names it with the same
 * `id`. Uncontrolled with `defaultValue`, controlled with `value`; an `onChange` hears each pick (issue 59's "Sort by").
 */
export function Select({
  id,
  name,
  options,
  defaultValue,
  value,
  onChange,
}: {
  id: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <select id={id} name={name} defaultValue={defaultValue} value={value} onChange={onChange} className="field">
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
