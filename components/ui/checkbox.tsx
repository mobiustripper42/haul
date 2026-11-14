import type { InputHTMLAttributes, ReactNode } from "react";
import { Hint } from "./hint";

/**
 * A checkbox with its sentence as the label, the whole line a tap target. Every other attribute passes
 * through; it sets no `value`, so a ticked box submits "on". `hint` is a muted line under the sentence,
 * inside the label and indented with it, so the box, its sentence and its hint are one target.
 */
export function Checkbox({
  children,
  hint,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style" | "type" | "children"> & {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex min-h-touch cursor-pointer items-start gap-3">
      <input {...rest} type="checkbox" className="mt-0.5 size-5 flex-none accent-teal" />
      <span className="flex flex-col gap-1">
        <span>{children}</span>
        {hint !== undefined && <Hint>{hint}</Hint>}
      </span>
    </label>
  );
}
