"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { lockPage } from "./page-lock";
import { Select } from "./select";
import { Spinner } from "./spinner";
import { useCacheRestore } from "./use-cache-restore";
import { useHeld } from "./use-held";

/**
 * A `Select` that applies on a pick (issue 235): it sends its form, turns itself off and locks the rest of the page, as a
 * tapped `SubmitButton` does, so a second pick cannot start a second load. While the week loads the ring stands where its
 * arrow is, for at least 600ms (AC17). For a form that loads a whole page, a GET, with no button of its own: the page
 * assumes its script runs (DEC-057).
 *
 * When the script starts and the dropdown holds something other than `defaultValue`, the value the page's content is for,
 * how the page was reached decides: after Back it is what the browser put back, so the dropdown shows `defaultValue` again
 * (AC5); otherwise it is a pick made before the script started, which is sent (AC16). When Back brings the page back from
 * the browser's cache, the dropdown shows `defaultValue`, comes back on and the page is unlocked.
 */
export function SelectThatApplies({ defaultValue, ...rest }: Omit<ComponentProps<typeof Select>, "value" | "onChange" | "disabled" | "ref" | "busy">) {
  const select = useRef<HTMLSelectElement>(null);
  const [loading, setLoading] = useState(false);
  const busy = useHeld(loading);

  // The form is collected inside `requestSubmit`, before the dropdown goes off, which would drop it from the form.
  const send = (control: HTMLSelectElement) => {
    if (!control.form) return;
    control.form.requestSubmit();
    setLoading(true);
  };

  const showShown = () => {
    if (select.current && defaultValue !== undefined) select.current.value = defaultValue;
  };

  // Once per value the page is for; `send` and `showShown` read only the ref and it.
  useEffect(() => {
    const control = select.current;
    if (!control || defaultValue === undefined || control.value === defaultValue) return;
    const [arrival] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (arrival?.type === "back_forward") showShown();
    else send(control);
  }, [defaultValue]);

  useCacheRestore(true, () => {
    showShown();
    setLoading(false);
  });

  useEffect(() => {
    if (!loading || !select.current) return;
    return lockPage([select.current]);
  }, [loading]);

  return (
    <span className="relative block">
      <Select {...rest} defaultValue={defaultValue} ref={select} onChange={(event) => send(event.currentTarget)} disabled={loading} busy={busy} />
      {busy && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink">
          <Spinner />
        </span>
      )}
    </span>
  );
}
