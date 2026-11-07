import type { ReactNode } from "react";

const CLASSES = { card: "card", fill: "card-fill", pane: "card-pane", reading: "card-reading" } as const;

/**
 * A card on a focused screen (issue 38, AC2). `width="fill"` fills its column instead of stopping at the
 * card's width; `width="pane"` is the card's width and centred below `lg`, and fills its column at `lg`
 * and wider (the Supper Club page's panes); `width="reading"` stops at the reading width, centred (the
 * Terms and Privacy pages).
 */
export function Card({ children, width = "card" }: { children: ReactNode; width?: "card" | "fill" | "pane" | "reading" }) {
  return <section className={CLASSES[width]}>{children}</section>;
}
