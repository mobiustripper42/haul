import type { ReactNode } from "react";

const LOOKS = {
  success: "bg-sage-soft text-success",
  /** A week an admin closed. An outline on the page's tint, so it reads without colour. */
  closed: "border border-border bg-surface-alt text-ink",
  /** A week whose pickup days moved. */
  moved: "bg-teal text-surface",
  /** A week that carries an admin's note. */
  note: "bg-sage-soft text-teal",
} as const;

export type BadgeKind = keyof typeof LOOKS;

/** A status word on a tint. Tasks 2.3 and 2.7 add the kinds for a declined card and a cancelled one. */
export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  return <span className={`inline-block flex-none rounded-sm px-2 py-0.5 text-small font-semibold ${LOOKS[kind]}`}>{children}</span>;
}
