"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition, type ComponentProps } from "react";
import { lockPage } from "./page-lock";
import { Select } from "./select";
import { Spinner } from "./spinner";
import { useHeld } from "./use-held";

/**
 * A `Select` that applies on a pick (issue 235), inside a GET form that names the page: a pick shows the page its form would
 * load, in place, as an in-app link does (issue 245), so the page's script keeps running from one pick to the next. While
 * the page loads the dropdown is off, the rest of the page locked, and the ring stands where its arrow is, for at least
 * 600ms. The page assumes its script runs (DEC-057): there is no button to send the form with.
 *
 * The browser keeps no value of its to put back (`autocomplete="off"`), so a dropdown the script finds holding something
 * other than `defaultValue` when it starts holds a pick made before then, which is shown (AC16). When the page changes
 * under it, Back included, it shows `defaultValue`, the value the page's content is for (AC5). A pick made with the focus on
 * it leaves the focus on it once the page arrives, as a tapped `SubmitButton` does (AC18).
 */
export function SelectThatApplies({ defaultValue, ...rest }: Omit<ComponentProps<typeof Select>, "value" | "onChange" | "disabled" | "ref" | "busy" | "autoComplete">) {
  const select = useRef<HTMLSelectElement>(null);
  const router = useRouter();
  const [loading, startLoading] = useTransition();
  const busy = useHeld(loading);

  // Whether the dropdown had the focus when its load began: off while loading, it loses it, and gets it back after (AC18).
  const hadFocus = useRef(false);
  const show = (control: HTMLSelectElement) => {
    const form = control.form;
    if (!form) return;
    hadFocus.current = document.activeElement === control;
    const url = new URL(form.action);
    url.search = new URLSearchParams([...new FormData(form)].map(([key, value]) => [key, String(value)])).toString();
    startLoading(() => router.push(`${url.pathname}${url.search}`, { scroll: false }));
  };

  // On the first run, a value other than `defaultValue` is a pick made before the script started; after it, the page has changed.
  const started = useRef(false);
  useEffect(() => {
    const control = select.current;
    if (!control || defaultValue === undefined || control.value === defaultValue) return;
    if (started.current) control.value = defaultValue;
    else show(control);
  }, [defaultValue]);
  useEffect(() => {
    started.current = true;
  }, []);

  useEffect(() => {
    if (!loading || !select.current) return;
    return lockPage([select.current]);
  }, [loading]);

  useEffect(() => {
    if (loading || !hadFocus.current) return;
    hadFocus.current = false;
    const focused = document.activeElement;
    if (!focused || focused === document.body) select.current?.focus();
  }, [loading]);

  return (
    <span className="relative block">
      <Select {...rest} defaultValue={defaultValue} ref={select} onChange={(event) => show(event.currentTarget)} disabled={loading} busy={busy} autoComplete="off" />
      {busy && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink">
          <Spinner />
        </span>
      )}
    </span>
  );
}
