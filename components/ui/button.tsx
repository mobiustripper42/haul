import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonKind = "primary" | "secondary" | "quiet";

export type ButtonProps = { kind: ButtonKind; full?: boolean; flush?: boolean; children: ReactNode } & (
  | { href: string; back?: boolean; current?: boolean }
  | (Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "children"> & {
      href?: never;
      back?: never;
      current?: never;
    })
);

/**
 * A button, or with `href` a link in the same look. It adds no attribute it is not given (issue 38, AC7,
 * AC8). A link's `current` marks the page it opens as the one showing: `aria-current="page"`, filled sage-soft.
 */
export function Button(props: ButtonProps) {
  const { kind, full, flush, children, href, back, current, ...rest } = props;
  if (href !== undefined) {
    const className = [`btn-${kind}`, back && "back-link", full && "w-full", flush && "btn-flush"].filter(Boolean).join(" ");
    return (
      <a href={href} className={className} {...(current ? { "aria-current": "page" as const } : {})}>
        {children}
      </a>
    );
  }
  const className = [`btn-${kind}`, full && "w-full", flush && "btn-flush"].filter(Boolean).join(" ");
  return (
    <button {...rest} className={className}>
      {children}
    </button>
  );
}
