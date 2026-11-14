import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonKind = "primary" | "secondary" | "quiet";

/** `true` lines the text up with the left edge; `"end"` with the right; `"end-narrow"` with the right below `lg` only. */
export type ButtonFlush = boolean | "end" | "end-narrow";

const FLUSH_CLASS = { start: "btn-flush", end: "btn-flush-end", "end-narrow": "btn-flush-end-narrow" } as const;
const flushClass = (flush: ButtonFlush | undefined) => (flush === true ? FLUSH_CLASS.start : flush ? FLUSH_CLASS[flush] : false);

export type ButtonProps = { kind: ButtonKind; full?: boolean; flush?: ButtonFlush; nowrap?: boolean; children: ReactNode } & (
  | { href: string; back?: boolean; current?: boolean }
  | (Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "children"> & {
      href?: never;
      back?: boolean;
      current?: never;
    })
);

/**
 * A button, or with `href` a link in the same look. It adds no attribute it is not given (issue 38, AC7,
 * AC8). A link's `current` marks the page it opens as the one showing: `aria-current="page"`, filled
 * sage-soft. `back` adds the back arrow, to a link or to a submit button. `nowrap` keeps the label on one line, for the header's buttons, which wrap as a row instead.
 */
export function Button(props: ButtonProps) {
  const { kind, full, flush, nowrap, children, href, back, current, ...rest } = props;
  if (href !== undefined) {
    const className = [`btn-${kind}`, back && "back-link", full && "w-full", flushClass(flush), nowrap && "btn-nowrap"].filter(Boolean).join(" ");
    return (
      <a href={href} className={className} {...(current ? { "aria-current": "page" as const } : {})}>
        {children}
      </a>
    );
  }
  const className = [`btn-${kind}`, back && "back-link", full && "w-full", flushClass(flush), nowrap && "btn-nowrap"].filter(Boolean).join(" ");
  return (
    <button {...rest} className={className}>
      {children}
    </button>
  );
}
