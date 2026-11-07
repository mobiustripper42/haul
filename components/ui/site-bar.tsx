import type { ReactNode } from "react";

const INNER = "mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4";

/**
 * The bar the header and the footer share (issue 97): a `<header>` or `<footer>` on `surface` with a
 * `divider` border on its inner edge, and a row inside it. The footer sits at the bottom of a short page.
 */
export function SiteBar({ as, children }: { as: "header" | "footer"; children: ReactNode }) {
  if (as === "footer") {
    return (
      <footer className="mt-auto border-t border-divider bg-surface">
        <div className={`${INNER} py-5`}>{children}</div>
      </footer>
    );
  }
  return (
    <header className="border-b border-divider bg-surface">
      <div className={`${INNER} py-3`}>{children}</div>
    </header>
  );
}
