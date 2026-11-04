/**
 * One question with its answers as radios: a fieldset under `legend`, an option per radio with its
 * label and, when given, a detail line. `selected` is the `value` checked when the page loads.
 */
export function OptionPicker({
  name,
  legend,
  options,
  selected,
}: {
  name: string;
  legend: string;
  options: { value: string; label: string; detail?: string }[];
  selected: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 font-display text-section text-teal">{legend}</legend>
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => (
          <label
            key={option.value}
            className="relative flex min-h-16 cursor-pointer flex-col justify-center rounded-md border border-border bg-surface px-4 py-3 has-checked:border-2 has-checked:border-teal has-checked:bg-sage-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-teal"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={option.value === selected}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <span className="font-semibold text-ink">{option.label}</span>
            {option.detail !== undefined && <span className="text-small text-ink-muted">{option.detail}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
