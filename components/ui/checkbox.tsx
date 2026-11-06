import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * A checkbox with its sentence as the label, the whole line a tap target. Every other attribute passes
 * through; it sets no `value`, so a ticked box submits "on".
 */
export function Checkbox({
  children,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style" | "type" | "children"> & { children: ReactNode }) {
  return (
    <label className="flex min-h-touch cursor-pointer items-start gap-3">
      <input {...rest} type="checkbox" className="mt-0.5 size-5 flex-none accent-teal" />
      <span>{children}</span>
    </label>
  );
}
