import type { ReactNode } from "react";

/**
 * The small muted line: every help and quiet line on a screen. A `span`, not a `p`, so it can sit
 * inside `Field`'s `<p>` without the browser closing that `<p>` at it.
 */
export function Hint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="block text-small text-ink-muted">
      {children}
    </span>
  );
}
