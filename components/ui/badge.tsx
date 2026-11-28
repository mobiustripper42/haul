import type { ReactNode } from "react";

/** An outline on the page's tint, so it reads without colour. */
const OUTLINE = "border border-border bg-surface-alt text-ink";

const LOOKS = {
  success: "bg-sage-soft text-success",
  /** A week an admin closed. */
  closed: OUTLINE,
  /** A week whose pickup days moved. */
  moved: "bg-teal text-surface",
  /** A week that carries an admin's note. */
  note: "bg-sage-soft text-teal",
  /** A cancelled subscription: the closed look, with no icon. */
  cancelled: OUTLINE,
  /** A card the charge run could not charge (issue 145). */
  declined: "bg-danger-soft text-danger",
  /** A week a declined card locked (issue 198): the closed look, with a padlock. */
  locked: OUTLINE,
  /** An account whose email is not confirmed (issue 263): the plain outline, no icon. */
  unconfirmed: OUTLINE,
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
  declined: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16v.5" />
    </>
  ),
  locked: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
};

/** A status word on a tint, with an icon for the kinds that have one. */
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
