import type { ReactNode } from "react";

export type NoticeIcon = "lock" | "clock" | "alert";

/** An alert with an icon before its words (issue 38, AC6). */
export function Notice({ icon, children }: { icon: NoticeIcon; children: ReactNode }) {
  return (
    <p role="alert" className={`notice notice-${icon}`}>
      {children}
    </p>
  );
}
