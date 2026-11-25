import type { ReactElement, ReactNode } from "react";

/**
 * A rolldown (issue 243): a `<details>` whose `<summary>` is `summary`, teal, with the chevron, which flips when it is open,
 * and whose body is `children`. The browser opens and closes it; there is no script. `open` is how it is drawn on load.
 */
export function Disclosure({ summary, open, children }: { summary: ReactNode; open?: boolean; children: ReactNode }): ReactElement {
  return (
    <details open={open === true}>
      <summary className="menu-chevron disclosure-summary">{summary}</summary>
      <div className="flex flex-col gap-2 pb-2">{children}</div>
    </details>
  );
}
