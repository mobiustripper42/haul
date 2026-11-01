import type { ReactNode } from "react";

/** The page a focused screen sits on (issue 38, AC1). */
export function Shell({ children }: { children: ReactNode }) {
  return <main className="page-narrow">{children}</main>;
}
