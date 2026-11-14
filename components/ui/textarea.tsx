import type { TextareaHTMLAttributes } from "react";

/** A multi-line text field, the sibling of `Input`: the same look, three lines tall unless `rows` says otherwise. Every other attribute passes through. */
export function Textarea({ rows = 3, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "style">) {
  return <textarea rows={rows} {...rest} className="field h-auto py-2" />;
}
