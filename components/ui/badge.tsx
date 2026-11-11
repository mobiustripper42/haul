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

/** The icon a kind carries beside its word, so the kind reads without colour. Drawn in the badge's text colour. */
const ICONS: Partial<Record<BadgeKind, ReactNode>> = {
  closed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 18.4L18.4 5.6" />
    </>
  ),
  moved: <path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />,
  note: <path d="M5 4h14v12H9l-4 4z" />,
};

/** A status word on a tint, with an icon for the kinds that have one. Tasks 2.3 and 2.7 add the kinds for a declined card and a cancelled one. */
export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  const icon = ICONS[kind];
  return (
    <span className={`inline-flex flex-none items-center gap-1 rounded-sm px-2 py-0.5 text-small font-semibold ${LOOKS[kind]}`}>
      {icon && (
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      )}
      {children}
    </span>
  );
}
