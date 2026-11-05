import type { ReactNode } from "react";

/** The uppercase label line: `teal` inside a panel, `muted` above a page's title. */
export function Eyebrow({ tone, children }: { tone: "teal" | "muted"; children: ReactNode }) {
  return <span className={`block text-label ${tone === "teal" ? "text-teal" : "text-teal-muted"}`}>{children}</span>;
}
