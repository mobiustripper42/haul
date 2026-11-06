import type { ReactNode } from "react";

/**
 * The page a screen sits on (issue 38, AC1). `narrow`, the default, centres one card; `page` is the
 * Supper Club page's container at the page's max width, two columns on a desktop and stacked on a phone;
 * `pane` is `page` at `lg` and wider and `narrow` below it, for a pane page whose left column is hidden there.
 */
export function Shell({ width = "narrow", children }: { width?: "narrow" | "page" | "pane"; children: ReactNode }) {
  return (
    <main
      className={
        width === "page"
          ? "mx-auto flex w-full max-w-page flex-col gap-8 px-4 py-12 lg:flex-row lg:items-start"
          : width === "pane"
            ? "page-pane"
            : "page-narrow"
      }
    >
      {children}
    </main>
  );
}
