import type { ReactNode } from "react";

export type NoticeIcon = "lock" | "clock" | "alert" | "check" | "info";

/**
 * An alert with an icon before its words (issue 38, AC6). With `lead`, the words open with it in bold on its own line
 * (issue 145), the children under it: one span beside the icon, not two flex columns.
 */
export function Notice({ icon, lead, children }: { icon: NoticeIcon; lead?: string; children: ReactNode }) {
  return (
    <p role="alert" className={`notice notice-${icon}`}>
      {lead === undefined ? (
        children
      ) : (
        <span>
          <strong className="block font-semibold text-teal">{lead}</strong> {children}
        </span>
      )}
    </p>
  );
}
