import type { ReactNode } from "react";
import { Hint } from "./hint";

export type WeekListRow = { id: string; title: string; lines: string[]; amount?: string; badge?: ReactNode; action?: ReactNode; below?: ReactNode };

/**
 * The account pages' weeks (issue 155): a list of rows, divided as the admin weeks list's. Each row's top is the title
 * and its first muted line on the left, and on the right, stacked and right-aligned, the badge, then the amount, each if
 * any, then an optional action (issues 137, 230). Every later line runs the row's full width below, so a long status
 * line is not squeezed beside the badge on a phone (issue 230), and then `below`, full width too (issue 243: a week's
 * rolldown). One column at every width: `RowList` does not fit, for it hides at 720px and wider.
 */
export function WeekList({ rows }: { rows: WeekListRow[] }) {
  return (
    <ul className="flex flex-col">
      {rows.map((row) => {
        const [first, ...rest] = row.lines;
        return (
          <li key={row.id} className="flex flex-col gap-1 border-t border-divider py-4 first:border-t-0">
            <div className="flex items-start gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-semibold">{row.title}</span>
                {first !== undefined && <Hint>{first}</Hint>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {row.badge}
                {row.amount !== undefined && <strong className="font-semibold">{row.amount}</strong>}
                {row.action}
              </div>
            </div>
            {rest.map((line) => (
              <Hint key={line}>{line}</Hint>
            ))}
            {row.below}
          </li>
        );
      })}
    </ul>
  );
}
