import type { InputHTMLAttributes } from "react";

/** A text field; `code` sets it in the code style. Every other attribute passes through (issue 38, AC5). */
export function Input({ code, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style"> & { code?: boolean }) {
  return <input {...rest} className={code ? "field field-code" : "field"} />;
}
