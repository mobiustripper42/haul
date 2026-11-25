import type { ReactElement, ReactNode } from "react";

/**
 * Two columns (issue 230, shared by issue 243): side by side at 1024px and wider, the left one first, and stacked below
 * it, the left one on top. Each column stacks what it holds, 20px apart. `rightId` is the right column's `id`, which a
 * link to it scrolls to below 1024px, with 16px above it; at 1024px and wider the column's scroll margin is deeper
 * than the page's top, so the link scrolls nothing and the page opens at the top.
 * Called inline, `{TwoColumns({ left, right })}`, as `MealPickers` is.
 */
export function TwoColumns({ left, right, rightId }: { left: ReactNode; right: ReactNode; rightId?: string }): ReactElement {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-5">{left}</div>
      <div id={rightId} className="flex min-w-0 flex-1 scroll-mt-4 flex-col gap-5 lg:scroll-mt-96">
        {right}
      </div>
    </div>
  );
}
