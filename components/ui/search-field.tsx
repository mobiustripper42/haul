import type { ChangeEvent } from "react";
import { Field } from "./field";
import { Input } from "./input";

/**
 * A labelled search box: an `Input` with the search icon drawn before it in CSS (`.search-box`). The caller owns
 * the text, so the list it filters and the box cannot disagree.
 */
export function SearchField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="max-w-card">
      <Field label={label} htmlFor={id}>
        <span className="search-box">
          <Input id={id} type="search" placeholder={placeholder} value={value} onChange={onChange} autoComplete="off" />
        </span>
      </Field>
    </div>
  );
}
