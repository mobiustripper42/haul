import type { ReactNode } from "react";

/**
 * The signed-in header's Admin ▾ group at 1024px and wider (issue 159): a `<details>` whose `<summary>` is
 * `label` and whose panel holds `children`. `active` marks the summary (`data-active`) when the page showing is one
 * of its links. `MenuScript` closes it on an outside click, focus moving outside it, or Escape; the panel is `MenuButton`'s, which this
 * replaced.
 */
export function MenuGroup({ label, active, children }: { label: string; active: boolean; children: ReactNode }) {
  return (
    <details data-menu-group className="menu-group">
      <summary className="menu-group-summary" data-active={active ? "" : undefined}>
        {label}
      </summary>
      <div className="absolute right-0 top-full z-10 mt-2 flex w-64 flex-col gap-2 rounded-md bg-surface p-4 shadow-modal">{children}</div>
    </details>
  );
}
