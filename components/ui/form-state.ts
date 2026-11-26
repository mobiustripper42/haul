/**
 * Has this form changed (issue 235): the form's whole state against the state the server sent, compared as strings, as
 * muster's `form-dirty.ts` does. Not a flag set by an event: a character typed then deleted, or a box ticked then
 * unticked, leaves the form as it was sent. `untilChanged` on `Button` is its first caller; the unsaved-changes guard
 * (issue 167) is the next.
 */

/**
 * The form's `[name, value]` pairs as one string. The order the pairs were read in does not matter, and a name sent twice
 * stays twice; an unticked box has no pair, so ticking one is a change.
 */
export function canonicalFormState(pairs: Iterable<[string, string]>): string {
  const sorted = [...pairs].sort(([nameA, valueA], [nameB, valueB]) => (nameA === nameB ? (valueA < valueB ? -1 : valueA > valueB ? 1 : 0) : nameA < nameB ? -1 : 1));
  return JSON.stringify(sorted);
}

/** What the form holds now, as the browser would send it. */
export function formState(form: HTMLFormElement): string {
  return canonicalFormState(Array.from(new FormData(form), ([name, value]): [string, string] => [name, typeof value === "string" ? value : value.name]));
}

/**
 * What the server sent: each control's own default, never what is in it now, so a value the browser put back after Back or
 * a refresh is a change. Read once when the page's script starts, because React keeps a controlled box's default in step
 * with what is typed in it (app/phone-input.tsx), so the phone box's cannot be read later.
 */
export function sentFormState(form: HTMLFormElement): string {
  const pairs: [string, string][] = [];
  for (const control of Array.from(form.elements)) {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) continue;
    if (!control.name || control.disabled) continue;
    if (control instanceof HTMLSelectElement) {
      const options = Array.from(control.options);
      const sent = options.filter((option) => option.defaultSelected && !option.disabled);
      // A dropdown with none marked shows its first enabled option, which is the one it sends.
      const shown = sent.length > 0 || control.multiple ? sent : options.filter((option) => !option.disabled).slice(0, 1);
      for (const option of shown) pairs.push([control.name, option.value]);
    } else if (control instanceof HTMLTextAreaElement) {
      pairs.push([control.name, control.defaultValue.replace(/\r\n?/g, "\n")]);
    } else if (control.type === "checkbox" || control.type === "radio") {
      if (control.defaultChecked) pairs.push([control.name, control.value]);
    } else if (!["submit", "button", "reset", "image", "file"].includes(control.type)) {
      pairs.push([control.name, control.defaultValue]);
    }
  }
  return canonicalFormState(pairs);
}
