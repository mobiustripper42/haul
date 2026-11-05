import type { ReactNode } from "react";
import { Eyebrow } from "./eyebrow";

/** The sage panel: its title an `Eyebrow`, then whatever it holds. */
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-sage-soft p-5">
      <Eyebrow tone="teal">{title}</Eyebrow>
      {children}
    </div>
  );
}
