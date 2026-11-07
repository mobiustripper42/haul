import type { ReactNode } from "react";

export type DataTableColumn = {
  id: string;
  label: string;
  /** Given, the header is a button that sorts by this column, and the header says which way it is sorted. */
  sort?: { direction: "ascending" | "descending" | "none"; onSort: () => void };
};

/**
 * A table of small cells whose sortable headers are buttons. `rows[n].cells` line up with `columns`; the first
 * cell is the row's name, set stronger. The sorted header carries `aria-sort` and the others `none`; the arrow
 * after the word is drawn from it in CSS (`.sort-button`), so no arrow is text. Below 720px the table is hidden
 * (`.data-table`), and `RowList` shows in its place.
 */
export function DataTable({ columns, rows }: { columns: DataTableColumn[]; rows: { id: string; cells: ReactNode[] }[] }) {
  return (
    <div className="data-table -mx-5 overflow-x-auto px-5">
      <table className="w-full border-collapse text-small">
        <thead>
          <tr className="border-b border-divider">
            {columns.map((column) =>
              column.sort ? (
                <th key={column.id} scope="col" aria-sort={column.sort.direction} className="p-0 text-left">
                  <button type="button" onClick={column.sort.onSort} className="sort-button">
                    {column.label}
                  </button>
                </th>
              ) : (
                <th key={column.id} scope="col" className="px-3 text-left text-label text-teal uppercase">
                  {column.label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-divider">
              {row.cells.map((cell, at) => (
                <td key={columns[at]?.id ?? at} className={at === 0 ? "whitespace-nowrap p-3 text-body-strong text-teal" : "p-3"}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
