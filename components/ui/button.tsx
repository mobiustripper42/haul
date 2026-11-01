import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonKind = "primary" | "secondary" | "quiet";

export type ButtonProps = { kind: ButtonKind; full?: boolean; flush?: boolean; children: ReactNode } & (
  | { href: string; back?: boolean }
  | (Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "children"> & { href?: never; back?: never })
);

/** A button, or with `href` a link in the same look. It adds no attribute it is not given (issue 38, AC7, AC8). */
export function Button(props: ButtonProps) {
  const { kind, full, flush, children } = props;
  if (props.href !== undefined) {
    const { href, back } = props;
    const className = [`btn-${kind}`, back && "back-link", full && "w-full", flush && "btn-flush"].filter(Boolean).join(" ");
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  const { kind: _kind, full: _full, flush: _flush, href: _href, back: _back, children: _children, ...rest } = props;
  void [_kind, _full, _flush, _href, _back, _children];
  const className = [`btn-${kind}`, full && "w-full", flush && "btn-flush"].filter(Boolean).join(" ");
  return (
    <button {...rest} className={className}>
      {children}
    </button>
  );
}
