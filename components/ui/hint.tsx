import type { ReactNode } from "react";

/**
 * The small muted line: every help and quiet line on a screen. A `span`, not a `p`, so it can sit
 * inside `Field`'s `<p>` without the browser closing that `<p>` at it. `rule` draws the sage rule
 * above it, 16px of padding below the rule, for a closing line set apart from the form. `center`
 * centres it under a button. `below` sets it 8px under the field above it, clear of the focus ring (issue 84).
 * `danger` draws it in the danger colour in place of the muted one, the size unchanged (issue 140: "No menu yet").
 */
export function Hint({
  id,
  rule,
  center,
  below,
  danger,
  children,
}: {
  id?: string;
  rule?: boolean;
  center?: boolean;
  below?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const colour = danger ? "text-danger" : "text-ink-muted";
  const look = rule ? `block border-t border-divider pt-4 text-small ${colour}` : `block text-small ${colour}`;
  return (
    <span id={id} className={[look, center && "text-center", below && "mt-2"].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
