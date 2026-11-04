import type { ReactNode } from "react";

/**
 * The small muted line: every help and quiet line on a screen. A `span`, not a `p`, so it can sit
 * inside `Field`'s `<p>` without the browser closing that `<p>` at it. `rule` draws the sage rule
 * above it, 16px of padding below the rule, for a closing line set apart from the form.
 */
export function Hint({ id, rule, children }: { id?: string; rule?: boolean; children: ReactNode }) {
  return (
    <span id={id} className={rule ? "block border-t border-divider pt-4 text-small text-ink-muted" : "block text-small text-ink-muted"}>
      {children}
    </span>
  );
}
