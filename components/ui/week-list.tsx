import type { ReactNode } from "react";
import { Hint } from "./hint";

export type WeekListRow = { id: string; title: string; lines: string[]; amount?: string; badge?: ReactNode; action?: ReactNode };

/**
 * The account pages' weeks (issue 155): a list of rows, divided as the admin weeks list's, each a left column
 * (the title, then its muted lines) and a right column, stacked and right-aligned: the badge, then the amount, each if
 * any, then an optional action (issues 137, 230). One column at every width: `RowList` does not fit, for it hides at
 * 720px and wider.
 */
export function WeekList({ rows }: { rows: WeekListRow[] }) {
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-divider py-4 first:border-t-0">
          <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
            <span className="font-semibold">{row.title}</span>
            {row.lines.map((line) => (
              <Hint key={line}>{line}</Hint>
            ))}
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            {row.badge}
            {row.amount !== undefined && <strong className="font-semibold">{row.amount}</strong>}
            {row.action}
          </div>
        </li>
      ))}
    </ul>
  );
}
