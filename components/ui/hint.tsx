import type { ReactNode } from "react";

/**
 * The small muted line: every help and quiet line on a screen. A `span`, not a `p`, so it can sit
 * inside `Field`'s `<p>` without the browser closing that `<p>` at it. `rule` draws the sage rule
 * above it, 16px of padding below the rule, for a closing line set apart from the form. `center`
 * centres it under a button.
 */
export function Hint({ id, rule, center, children }: { id?: string; rule?: boolean; center?: boolean; children: ReactNode }) {
  const look = rule ? "block border-t border-divider pt-4 text-small text-ink-muted" : "block text-small text-ink-muted";
  return (
    <span id={id} className={center ? `${look} text-center` : look}>
      {children}
    </span>
  );
}
