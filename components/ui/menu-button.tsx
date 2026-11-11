import type { ReactNode } from "react";

/**
 * A disclosure button, `<details>`/`<summary>`, so it opens with no client script: the three-line icon and its
 * label, and a panel under it holding `children`. The signed-in header's Menu below 720px (issue 155).
 */
export function MenuButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="relative">
      <summary className="btn-secondary list-none gap-2 whitespace-nowrap">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        {label}
      </summary>
      <div className="absolute right-0 top-full z-10 mt-2 flex w-64 flex-col gap-2 rounded-md bg-surface p-4 shadow-modal">{children}</div>
    </details>
  );
}
