import type { ReactNode } from "react";

/** The danger line under a failing field; `id` is what the input's `aria-describedby` names. A `span`, for `Field`'s `<p>`. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} className="mt-2 block text-small text-danger">
      {children}
    </span>
  );
}
