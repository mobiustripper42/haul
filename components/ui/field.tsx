import type { ReactNode } from "react";
import { Hint } from "./hint";

/**
 * A labelled field: the caller gives the `Input` the same `id` as `htmlFor` (issue 38, AC4). `help` is
 * a `Hint` 8px below the field with the id `<htmlFor>-help`, which the caller names in the input's
 * `aria-describedby`.
 */
export function Field({
  label,
  htmlFor,
  help,
  children,
}: {
  label: string;
  htmlFor: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <p>
      <label htmlFor={htmlFor} className="mb-2 block text-field-label">
        {label}
      </label>
      {children}
      {help !== undefined && (
        <Hint id={`${htmlFor}-help`} below>
          {help}
        </Hint>
      )}
    </p>
  );
}
