import type { ReactNode } from "react";
import { Spinner } from "./spinner";

/**
 * Issue 240: a control's words, or while `busy` the ring over them. At rest it is its children alone, no wrapper and no
 * attribute. Busy, the words go invisible and keep their space, so the control keeps its size, and stay in the accessible
 * name: not `visibility: hidden`, not `aria-hidden`, and written once. The ring is `Spinner`, in the colour of the words.
 */
export function WaitingLabel({ busy, children }: { busy: boolean; children: ReactNode }) {
  if (!busy) return children;
  return (
    <span aria-busy="true" className="relative inline-flex">
      <span className="flex flex-col opacity-0">{children}</span>
      <span className="absolute inset-0 flex items-center justify-center">
        <Spinner />
      </span>
    </span>
  );
}
