import type { ReactNode } from "react";

const CLASSES = { card: "card", fill: "card-fill", pane: "card-pane" } as const;

/**
 * A card on a focused screen (issue 38, AC2). `width="fill"` fills its column instead of stopping at the
 * card's width; `width="pane"` is the card's width and centred below `lg`, and fills its column at `lg`
 * and wider (the Supper Club page's panes).
 */
export function Card({ children, width = "card" }: { children: ReactNode; width?: "card" | "fill" | "pane" }) {
  return <section className={CLASSES[width]}>{children}</section>;
}
