import type { ReactNode } from "react";

/**
 * The page a screen sits on (issue 38, AC1). `narrow`, the default, centres one card; `page` is the
 * Supper Club page's container at the page's max width, two columns on a desktop and stacked on a phone.
 */
export function Shell({ width = "narrow", children }: { width?: "narrow" | "page"; children: ReactNode }) {
  return (
    <main
      className={
        width === "page" ? "mx-auto flex w-full max-w-page flex-col gap-8 px-4 py-12 lg:flex-row lg:items-start" : "page-narrow"
      }
    >
      {children}
    </main>
  );
}
