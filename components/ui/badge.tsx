import type { ReactNode } from "react";

const LOOKS = { success: "bg-sage-soft text-success" } as const;

export type BadgeKind = keyof typeof LOOKS;

/** A status word on a tint. `success` only for now: tasks 2.3 and 2.7 add the kinds for a declined card and a cancelled one. */
export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  return <span className={`inline-block flex-none rounded-sm px-2 py-0.5 text-small font-semibold ${LOOKS[kind]}`}>{children}</span>;
}
