import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { isInAppHref } from "./in-app-href";
import { LinkLabel } from "./link-label";
import { SubmitButton } from "./submit-button";

/**
 * `strong` is the teal-filled emphasis button, the inverse of `secondary` (issue 230): for a screen where gold is taken,
 * or where several rows each need an emphasised action, which gold, one to a screen (docs/BRAND.md), cannot give.
 */
export type ButtonKind = "primary" | "secondary" | "strong" | "quiet" | "menu";

/** `true` lines the text up with the left edge; `"end"` with the right; `"end-narrow"` with the right below `lg` only. */
export type ButtonFlush = boolean | "end" | "end-narrow";

const FLUSH_CLASS = { start: "btn-flush", end: "btn-flush-end", "end-narrow": "btn-flush-end-narrow" } as const;
const flushClass = (flush: ButtonFlush | undefined) => (flush === true ? FLUSH_CLASS.start : flush ? FLUSH_CLASS[flush] : false);

export type ButtonProps = { kind: ButtonKind; full?: boolean; flush?: ButtonFlush; nowrap?: boolean; children: ReactNode } & (
  | { href: string; back?: boolean; current?: boolean; download?: boolean; loadsPage?: never }
  | (Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "children"> & {
      href?: never;
      back?: boolean;
      current?: never;
      download?: never;
      loadsPage?: boolean;
    })
);

/**
 * A button, or with `href` a link in the same look. It adds no attribute it is not given (issue 38, AC7,
 * AC8). A button is a `SubmitButton` and an in-app link holds a `LinkLabel`, which show the ring while a form is sent or a
 * page loads (issue 240); `loadsPage` is for a button whose form loads a whole page. A link's `current` marks the page it opens as the one showing: `aria-current="page"`, filled
 * sage-soft. `back` adds the back arrow, to a link or to a submit button. `nowrap` keeps the label on one line, for the header's buttons, which wrap as a row instead.
 */
export function Button(props: ButtonProps) {
  const { kind, full, flush, nowrap, children, href, back, current, download, loadsPage, ...rest } = props;
  if (href !== undefined) {
    const className = [`btn-${kind}`, back && "back-link", full && "w-full", flushClass(flush), nowrap && "btn-nowrap"].filter(Boolean).join(" ");
    const aria = current ? { "aria-current": "page" as const } : {};
    // A download is named, not guessed from the path: a plain <a>, whatever its href (issue 245). It carries no `download`
    // attribute, which would keep a turned-away download from opening the sign-in page (issue 240), and no ring.
    if (isInAppHref(href) && !download) {
      return (
        <Link href={href} className={className} {...aria}>
          <LinkLabel>{children}</LinkLabel>
        </Link>
      );
    }
    return (
      <a href={href} className={className} {...aria}>
        {children}
      </a>
    );
  }
  const className = [`btn-${kind}`, back && "back-link", full && "w-full", flushClass(flush), nowrap && "btn-nowrap"].filter(Boolean).join(" ");
  return (
    <SubmitButton {...rest} loadsPage={loadsPage} className={className}>
      {children}
    </SubmitButton>
  );
}
