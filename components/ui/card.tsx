import type { ReactNode } from "react";

/** A card on a focused screen (issue 38, AC2). */
export function Card({ children }: { children: ReactNode }) {
  return <section className="card">{children}</section>;
}
