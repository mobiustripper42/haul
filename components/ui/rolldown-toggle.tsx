import type { ReactNode } from "react";

/**
 * A person's rolldown toggle on the members list, desktop and phone (issue 263): a button that says whether the lines
 * under its row are open, in the look of every other rolldown (`.menu-chevron`, `.disclosure-summary`), its chevron turned
 * over while `open`. The list owns what is open; this only draws the toggle and reports the press.
 */
export function RolldownToggle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="menu-chevron disclosure-summary">
      {children}
    </button>
  );
}
