"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `active`, kept on for at least `minMs` from when it turned on, so a quick answer still shows the ring long enough to be
 * seen (issue 240). On the moment `active` is true; it ends `minMs` after it began, or when `active` ends if that is later.
 */
export function useHeld(active: boolean, minMs = 600): boolean {
  const [held, setHeld] = useState(false);
  const since = useRef<number | null>(null);
  useEffect(() => {
    if (active) {
      since.current = performance.now();
      setHeld(true);
      return;
    }
    if (since.current === null) return;
    const wait = Math.max(0, minMs - (performance.now() - since.current));
    const timer = setTimeout(() => {
      since.current = null;
      setHeld(false);
    }, wait);
    return () => clearTimeout(timer);
  }, [active, minMs]);
  return active || held;
}
