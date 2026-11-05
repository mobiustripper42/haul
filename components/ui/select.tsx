/** A select at the field height, in the text field's look. The caller's `Field` label names it with the same `id`. */
export function Select({
  id,
  name,
  options,
  defaultValue,
}: {
  id: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue: string;
}) {
  return (
    <select id={id} name={name} defaultValue={defaultValue} className="field">
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
