import type { ReactNode } from "react";

/**
 * Issue 222: a ring in the colour of the words around it, sized to the line beside it (issue 240: one look, not the
 * theme's teal). It says nothing to a screen reader (the line beside it does) and stops turning under
 * `prefers-reduced-motion`, leaving the ring still.
 */
export function Spinner(): ReactNode {
  return <span aria-hidden="true" className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />;
}
