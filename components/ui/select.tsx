import type { ChangeEvent, Ref } from "react";

/**
 * A select at the field height, in the text field's look, its arrow drawn by `select.field` in app/globals.css (issue 240). The
 * caller's `Field` label names it with the same `id`. Uncontrolled with `defaultValue`, controlled with `value`; an `onChange` hears each pick (issue 59's "Sort by"). `ref` and `disabled` are for `SelectThatApplies` (issue 235).
 */
export function Select({
  id,
  name,
  options,
  defaultValue,
  value,
  onChange,
  disabled,
  ref,
}: {
  id: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  ref?: Ref<HTMLSelectElement>;
}) {
  return (
    <select ref={ref} id={id} name={name} defaultValue={defaultValue} value={value} onChange={onChange} disabled={disabled} className="field">
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
