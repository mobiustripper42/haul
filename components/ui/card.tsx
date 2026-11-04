import type { ReactNode } from "react";

/** A card on a focused screen (issue 38, AC2). `width="fill"` fills its column instead of stopping at the card's width. */
export function Card({ children, width = "card" }: { children: ReactNode; width?: "card" | "fill" }) {
  return <section className={width === "fill" ? "card-fill" : "card"}>{children}</section>;
}
