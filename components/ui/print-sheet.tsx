import type { ReactNode } from "react";
import { Button } from "./button";
import { Heading } from "./heading";
import { Hint } from "./hint";

/**
 * A letter-shaped sheet for paper (issue 142): the wordmark, a heading, a meta line, a table with a check box drawn in
 * each row, and a closing line; the one page with no site header and no admin nav, so it is its own `main`. `columns[0]`
 * names the check box column, its header visually hidden; the other columns line up with each row's `cells`. `back` is
 * a link above the sheet that does not print.
 */
export function PrintSheet({
  wordmark,
  heading,
  meta,
  columns,
  rows,
  closing,
  back,
}: {
  wordmark: string;
  heading: string;
  meta: string;
  columns: string[];
  rows: { id: string; cells: ReactNode[] }[];
  closing?: string;
  back: { href: string; label: string };
}) {
  const [boxColumn, ...named] = columns;
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-5 px-4 py-10 print:max-w-none print:p-0">
      <div className="print:hidden">
        <Button kind="quiet" href={back.href} back>
          {back.label}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-display text-wordmark text-teal uppercase">{wordmark}</span>
        <Heading>{heading}</Heading>
        <Hint>{meta}</Hint>
      </div>
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="w-8 p-2 text-left">
              <span className="sr-only">{boxColumn}</span>
            </th>
            {named.map((column) => (
              <th key={column} scope="col" className="p-2 text-left text-label text-teal uppercase">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-divider">
              <td className="p-2">
                <span aria-hidden="true" className="block size-4 border border-ink" />
              </td>
              {row.cells.map((cell, at) => (
                <td key={named[at] ?? at} className={at === 0 ? "p-2 text-body-strong" : "p-2"}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {closing && <p>{closing}</p>}
    </main>
  );
}
