import type { PropsWithChildren } from "react";

/**
 * A screen's title (issue 38, AC3): an `h1`. `level={2}` is a card's heading, an `h2` in the section type
 * style (issue 59, AC7). `look="title"` with level 2 draws the `h2` in the title's style (issue 243): the second title
 * on a page of two lists.
 */
export function Heading({ level, look, children }: PropsWithChildren<{ level?: 2; look?: "title" }>) {
  if (level === 2) return <h2 className={`font-display ${look === "title" ? "text-heading" : "text-section"} text-teal`}>{children}</h2>;
  return <h1 className="font-display text-heading text-teal">{children}</h1>;
}
