import type { ReactNode } from "react";

/**
 * The signed-in header's drawer below 1024px (issue 159): the hamburger, and a panel from the right over a dimmed
 * page. A `<details>`, so it opens and closes with no script, and navigation never depends on JavaScript;
 * `MenuScript` adds Escape, a tap on the dimmed page and the page behind made `inert`. The ✕ is this
 * `<summary>`, drawn above the open panel with its icon swapped (the look is in app/globals.css): it is the only
 * control that closes a `<details>` with no script. Its name is visually hidden text, `label` while shut and
 * `closeLabel` while open. The drawer draws what it is given and no link of its own: `heading` above, `children` the
 * rows, `foot` last.
 */
export function MenuDrawer({
  label,
  closeLabel,
  heading,
  children,
  foot,
}: {
  label: string;
  closeLabel: string;
  heading: ReactNode;
  children: ReactNode;
  foot: ReactNode;
}) {
  return (
    <details data-menu-drawer className="menu-drawer">
      <summary className="menu-drawer-toggle">
        <span className="menu-label-shut sr-only">{label}</span>
        <span className="menu-label-open sr-only">{closeLabel}</span>
      </summary>
      <div data-menu-drawer-panel aria-label={label} className="menu-drawer-panel">
        <div className="mb-2 flex min-h-touch items-center px-3">{heading}</div>
        {/* `-m-1 p-1`: a scrolling box clips what is drawn past its edge, and a row's focus ring sits outside the row. */}
        <div className="-m-1 flex flex-col gap-1 overflow-y-auto p-1">{children}</div>
        <div className="mt-auto flex flex-col gap-1 border-t border-divider pt-2">{foot}</div>
      </div>
    </details>
  );
}
