import type { PropsWithChildren } from "react";

/**
 * A screen's title (issue 38, AC3): an `h1`. `level={2}` is a card's heading, an `h2` in the section type
 * style (issue 59, AC7).
 */
export function Heading({ level, children }: PropsWithChildren<{ level?: 2 }>) {
  if (level === 2) return <h2 className="font-display text-section text-teal">{children}</h2>;
  return <h1 className="font-display text-heading text-teal">{children}</h1>;
}
