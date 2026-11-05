import type { ReactNode } from "react";

/** Two buttons side by side, primary first; on a phone they stack, each full width. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 sm:flex-row [&>*]:flex-1">{children}</div>;
}
