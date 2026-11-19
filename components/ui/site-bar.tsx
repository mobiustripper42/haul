import type { ReactNode } from "react";

const row = (width: "max-w-page" | "max-w-bar") => `mx-auto flex ${width} flex-wrap items-center justify-between gap-3 px-4`;
const INNER = row("max-w-page");

/**
 * The bar the header and the footer share (issue 97): a `<header>` or `<footer>` on `surface` with a
 * `divider` border on its inner edge, and a row inside it. The footer sits at the bottom of a short page.
 * `wide` runs the header's row at `max-w-bar` in place of the page's width (issue 159): only the signed-in
 * header passes it, so its four links, Admin and Sign out fit beside the farm's name at 1024px.
 */
export function SiteBar({ as, wide, children }: { as: "header" | "footer"; wide?: boolean; children: ReactNode }) {
  if (as === "footer") {
    return (
      <footer className="mt-auto border-t border-divider bg-surface">
        <div className={`${INNER} py-5`}>{children}</div>
      </footer>
    );
  }
  return (
    <header className="border-b border-divider bg-surface">
      <div className={`${wide ? row("max-w-bar") : INNER} py-3`}>{children}</div>
    </header>
  );
}
