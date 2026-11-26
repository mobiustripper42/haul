"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ComponentProps } from "react";
import { lockPage } from "./page-lock";
import { Select } from "./select";
import { useCacheRestore } from "./use-cache-restore";

/**
 * A `Select` that applies on a pick (issue 235): it sends its form, turns itself off and locks the rest of the page, as a
 * tapped `SubmitButton` does, so a second pick cannot start a second load. For a form that loads a whole page, a GET: its
 * Show button is there only for a page with no script (`withoutScript`). The dropdown shows `defaultValue`, the value the
 * page's content is for, whatever the browser put in it: when the script starts, which is after Back reloaded the page, and
 * when Back brings the page back from the browser's cache, where it also comes back on and the page unlocked.
 */
export function SelectThatApplies({ defaultValue, ...rest }: Omit<ComponentProps<typeof Select>, "value" | "onChange" | "disabled" | "ref">) {
  const select = useRef<HTMLSelectElement>(null);
  const [loading, setLoading] = useState(false);

  const showShown = () => {
    if (select.current && defaultValue !== undefined) select.current.value = defaultValue;
  };

  useEffect(showShown, [defaultValue]);

  useCacheRestore(true, () => {
    showShown();
    setLoading(false);
  });

  useEffect(() => {
    if (!loading || !select.current) return;
    return lockPage([select.current]);
  }, [loading]);

  // The form is collected inside `requestSubmit`, before the dropdown goes off, which would drop it from the form.
  const pick = (event: ChangeEvent<HTMLSelectElement>) => {
    const form = event.currentTarget.form;
    if (!form) return;
    form.requestSubmit();
    setLoading(true);
  };

  return <Select {...rest} defaultValue={defaultValue} ref={select} onChange={pick} disabled={loading} />;
}
