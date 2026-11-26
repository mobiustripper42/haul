"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { useFormStatus } from "react-dom";
import { formState, sentFormState } from "./form-state";
import { lockPage } from "./page-lock";
import { useCacheRestore } from "./use-cache-restore";
import { useHeld } from "./use-held";
import { WaitingLabel } from "./waiting-label";

/**
 * `Button`'s button form (issue 240). It learns for itself that it was the one tapped: a click on it, and Enter in a field
 * counts as a tap on the form's default submit button, which the browser clicks. Another button submitting the form
 * clears it. While its form is being sent it is off and busy, with the ring over its words, and the rest of the page is
 * locked. The lock ends when the answer comes; the ring stays for 600ms from the tap (`useHeld`), then the focus comes
 * back to the button if it had it and nothing else has it by then.
 *
 * `loadsPage` is for a form that loads a whole page (a GET, or a POST to a route): it has no pending state to follow. It
 * turns off just after the browser has collected the form, since turning off sooner drops which button was tapped, and
 * comes back on when the page is restored from the browser's cache (`useCacheRestore`).
 *
 * `untilChanged` is a Save that is off until its form changes (issue 235): its label is that text while the form holds what
 * the server sent, read once when the button mounts, and its children once it holds anything else. The server sends it off,
 * as the script keeps it: the page assumes its script runs (DEC-057).
 *
 * At rest it is a `<button>` with the attributes it was given, and its children alone.
 */
export function SubmitButton({
  loadsPage,
  untilChanged,
  children,
  disabled,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { loadsPage?: boolean; untilChanged?: string }) {
  const { pending } = useFormStatus();
  const button = useRef<HTMLButtonElement>(null);
  const [tapped, setTapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wasPending, setWasPending] = useState(false);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending) setTapped(false);
  }
  const sending = pending && tapped;
  const held = useHeld(sending);
  const busy = held || loading;
  const locked = sending || loading;

  // The server's values, read the first time the form is watched, which is when the script starts. Nothing watches a button that is not `untilChanged`.
  const sent = useRef<string | null>(null);
  const watching = untilChanged !== undefined;
  const watchForm = useCallback(
    (notify: () => void) => {
      const form = button.current?.form;
      if (!watching || !form) return () => {};
      sent.current ??= sentFormState(form);
      // On the document, which hears an event after React has: a box React formats as it is typed (app/phone-input.tsx) holds its typed text until then.
      const changed = (event: Event) => event.target instanceof Node && form.contains(event.target) && notify();
      document.addEventListener("input", changed);
      document.addEventListener("change", changed);
      return () => {
        document.removeEventListener("input", changed);
        document.removeEventListener("change", changed);
      };
    },
    [watching],
  );
  const unchanged = useSyncExternalStore(
    watchForm,
    () => {
      if (!watching) return false;
      const form = button.current?.form;
      // Off until the form is watched: the server's page, and a form a save remounted, start as sent.
      if (!form || sent.current === null) return true;
      return formState(form) === sent.current;
    },
    () => watching,
  );

  const hadFocus = useRef(false);
  useEffect(() => {
    const own = button.current;
    const form = own?.form;
    if (!own || !form) return;
    const onSubmit = (event: SubmitEvent) => {
      if (event.submitter !== own) {
        setTapped(false);
        return;
      }
      // A timer, not a microtask: the browser collects the form when this event's listeners have returned.
      if (loadsPage) setTimeout(() => !event.defaultPrevented && setLoading(true), 0);
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [loadsPage]);

  useCacheRestore(!!loadsPage, () => {
    setLoading(false);
    setTapped(false);
  });

  useEffect(() => {
    if (!locked || !button.current) return;
    return lockPage([button.current]);
  }, [locked]);

  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    const focused = document.activeElement;
    if (hadFocus.current && (!focused || focused === document.body)) button.current?.focus();
    hadFocus.current = false;
  }, [busy]);

  // The tap is read from the click, which React replays when a button is tapped before the page has hydrated; a submit event
  // is not. It turns nothing off yet: the button goes off when the form is pending, after the browser has collected it.
  const tap = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.currentTarget.type !== "submit") return;
    hadFocus.current = document.activeElement === event.currentTarget;
    setTapped(true);
  };

  return (
    <button {...rest} ref={button} onClick={tap} disabled={busy || unchanged ? true : disabled} aria-busy={busy ? true : undefined}>
      <WaitingLabel busy={busy}>{unchanged ? untilChanged : children}</WaitingLabel>
    </button>
  );
}
