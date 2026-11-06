import { Hint } from "./hint";

/**
 * The grey panel, with no title (`Panel` is the sage one, with a title): an optional summary line, then
 * a label and an amount per row, then a small closing note.
 */
export function PricePanel({
  summary,
  rows,
  note,
}: {
  summary?: string;
  rows: { label: string; value: string }[];
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-alt p-4">
      {summary !== undefined && <span className="font-semibold">{summary}</span>}
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-4">
          <span>{row.label}</span>
          <strong className="font-semibold">{row.value}</strong>
        </div>
      ))}
      {note !== undefined && <Hint>{note}</Hint>}
    </div>
  );
}
