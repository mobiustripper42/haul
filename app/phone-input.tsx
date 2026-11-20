"use client";

import { useState, type ComponentProps } from "react";
import { formatPhoneTyping } from "@core/phone.js";
import { Input } from "../components/ui/input";

/** Issue 222: the phone box, its value formatted as it is typed (`formatPhoneTyping`); `defaultValue` is where it starts. */
export function PhoneInput({ defaultValue, ...rest }: ComponentProps<typeof Input> & { defaultValue: string }) {
  const [value, setValue] = useState(() => formatPhoneTyping(defaultValue));
  return <Input {...rest} value={value} onChange={(event) => setValue(formatPhoneTyping(event.target.value))} />;
}
