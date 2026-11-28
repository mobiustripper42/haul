import { Fragment, type ReactNode } from "react";

export type DataTableColumn = {
  id: string;
  label: string;
  /** Given, the header is a button that sorts by this column, and the header says which way it is sorted. */
  sort?: { direction: "ascending" | "descending" | "none"; onSort: () => void };
  /** A column of numbers: its header and cells, and its footer cell, are right-aligned. */
  numeric?: boolean;
};

/**
 * A table of small cells whose sortable headers are buttons. `rows[n].cells` line up with `columns`; the first
 * cell is the row's name, set stronger. The sorted header carries `aria-sort` and the others `none`; the arrow
 * after the word is drawn from it in CSS (`.sort-button`), so no arrow is text. Below 720px the table is hidden
 * (`.data-table`), and `RowList` shows in its place, unless `always` keeps it shown. `footer`, given, is a closing row
 * of cells lining up with `columns`, set stronger (issue 142: a total). A row's `under` lines are rows of cells lining up
 * with `columns` too, drawn muted below it and read as part of it (issue 263: a person's earlier subscriptions). A row given `under`, even
 * empty while its lines are closed, has a cell taller than one line (a name with its toggle), so its cells sit at the top,
 * lining its first line up with the name.
 */
export function DataTable({
  columns,
  rows,
  footer,
  always = false,
}: {
  columns: DataTableColumn[];
  rows: { id: string; cells: ReactNode[]; under?: { id: string; cells: ReactNode[] }[] }[];
  footer?: ReactNode[];
  always?: boolean;
}) {
  const align = (at: number): string => (columns[at]?.numeric ? "text-right" : "text-left");
  return (
    <div className={`${always ? "" : "data-table "}-mx-card-padding overflow-x-auto px-card-padding`}>
      <table className="w-full border-collapse text-small">
        <thead>
          <tr className="border-b border-divider">
            {columns.map((column, at) =>
              column.sort ? (
                <th key={column.id} scope="col" aria-sort={column.sort.direction} className={`p-0 ${align(at)}`}>
                  <button type="button" onClick={column.sort.onSort} className="sort-button">
                    {column.label}
                  </button>
                </th>
              ) : (
                <th key={column.id} scope="col" className={`px-3 ${align(at)} text-label text-teal uppercase`}>
                  {column.label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const lines = row.under ?? [];
            const rowClass = [lines.length > 0 ? "" : "border-b border-divider", row.under ? "align-top" : ""].filter(Boolean).join(" ");
            return (
              <Fragment key={row.id}>
                <tr className={rowClass}>
                  {row.cells.map((cell, at) => (
                    <td key={columns[at]?.id ?? at} className={at === 0 ? `whitespace-nowrap p-3 text-body-strong text-teal ${align(at)}` : `p-3 ${align(at)}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
                {lines.map((line, n) => (
                  <tr key={line.id} className={n === lines.length - 1 ? "border-b border-divider" : ""}>
                    {line.cells.map((cell, at) => (
                      <td key={columns[at]?.id ?? at} className={`px-3 py-2 text-ink-muted ${align(at)}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
        {footer && (
          <tfoot>
            <tr>
              {footer.map((cell, at) => (
                <td key={columns[at]?.id ?? at} className={`p-3 text-body-strong text-teal ${align(at)}`}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
