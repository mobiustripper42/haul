import type { ReactNode } from "react";

export type NoticeIcon = "lock" | "clock" | "alert" | "check" | "info";

/**
 * An alert with an icon before its words (issue 38, AC6). With `lead`, the words open with it in bold on its own line
 * (issue 145), the children under it: one span beside the icon, not two flex columns. With `action` (issue 238), a button
 * under the words on a line of its own, in the same span, with or without a lead.
 */
export function Notice({ icon, lead, action, children }: { icon: NoticeIcon; lead?: string; action?: ReactNode; children: ReactNode }) {
  const actionLine = action === undefined ? null : <span className="mt-3 block">{action}</span>;
  return (
    <p role="alert" className={`notice notice-${icon}`}>
      {lead === undefined ? (
        actionLine === null ? (
          children
        ) : (
          <span>
            {children} {actionLine}
          </span>
        )
      ) : (
        <span>
          <strong className="block font-semibold text-teal">{lead}</strong> {children}
          {actionLine && <> {actionLine}</>}
        </span>
      )}
    </p>
  );
}
