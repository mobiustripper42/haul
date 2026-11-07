import type { ReactNode } from "react";

/**
 * An inline link inside a sentence: underlined and teal, because a raw `<a>` reads as plain text (issue 44).
 * `newTab` opens it in a new tab, with `rel="noopener noreferrer"`, for a link that must not take the reader
 * off a form they are filling in. `Button` is a block control, not a link inside a sentence.
 */
export function TextLink({ href, newTab, children }: { href: string; newTab?: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-teal underline"
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}
