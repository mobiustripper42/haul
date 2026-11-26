import type { ReactNode } from "react";

/**
 * A row's More (issue 220): a `<details>` whose `<summary>` is a secondary button with a chevron, labelled `label`, and
 * whose panel holds `children`. `MenuScript` closes it on an outside click, focus moving outside it, or Escape. `name` is
 * the summary's `aria-label` when it needs one apart from its text.
 */
export function MenuGroup({ label, name, children }: { label: string; name?: string; children: ReactNode }) {
  return (
    <details data-menu-group className="relative">
      <summary className="btn-secondary menu-chevron" aria-label={name}>
        {label}
      </summary>
      <div className="absolute right-0 top-full z-10 mt-2 flex w-64 flex-col gap-2 rounded-md bg-surface p-4 shadow-modal">{children}</div>
    </details>
  );
}
