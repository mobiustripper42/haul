"use client";

import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";
import { WaitingLabel } from "./waiting-label";

/** Inside a `next/link`: the link's words, or the ring over them while the link's page is loading (issue 240). */
export function LinkLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <WaitingLabel busy={pending}>{children}</WaitingLabel>;
}
