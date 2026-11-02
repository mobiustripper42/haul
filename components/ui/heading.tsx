import type { ReactNode } from "react";

/** A screen's title (issue 38, AC3). */
export function Heading({ children }: { children: ReactNode }) {
  return <h1 className="font-display text-heading text-teal">{children}</h1>;
}
