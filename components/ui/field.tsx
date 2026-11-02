import type { ReactNode } from "react";

/** A labelled field: the caller gives the `Input` the same `id` as `htmlFor` (issue 38, AC4). */
export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <p>
      <label htmlFor={htmlFor} className="mb-2 block text-field-label">
        {label}
      </label>
      {children}
    </p>
  );
}
