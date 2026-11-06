import type { ReactNode } from "react";

/**
 * The table's rows stacked inside a card, for phone width: each is a name with a badge beside it, a line of
 * detail, and a smaller muted line. `before` sits above the rows (the "Sort by" field). Hidden at 720px and
 * wider (`.row-list`), where `DataTable` shows.
 */
export function RowList({
  before,
  rows,
}: {
  before?: ReactNode;
  rows: { id: string; title: string; badge: ReactNode; detail: string; note: string }[];
}) {
  return (
    <div className="row-list flex-col gap-3">
      {before}
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-1 border-t border-divider py-4">
            <span className="flex items-start justify-between gap-3">
              <strong className="font-semibold text-teal">{row.title}</strong>
              {row.badge}
            </span>
            <span>{row.detail}</span>
            <span className="text-small text-ink-muted">{row.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
