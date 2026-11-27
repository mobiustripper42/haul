"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `onRestore` when the browser shows this page from its back-forward cache (a `pageshow` with `persisted`), while
 * `enabled`: the page comes back as it was left, so what a tap turned off for the load has to be put back. `SubmitButton`'s
 * (issue 240), in a file of its own since issue 235. The caller's `onRestore` may change between renders without the listener being replaced.
 */
export function useCacheRestore(enabled: boolean, onRestore: () => void): void {
  const restore = useRef(onRestore);
  useEffect(() => {
    restore.current = onRestore;
  });

  useEffect(() => {
    if (!enabled) return;
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) restore.current();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [enabled]);
}
