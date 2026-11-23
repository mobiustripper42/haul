import { safeReturnTo } from "@core/return-to.js";

/**
 * Whether `href` is a link inside this app (issue 245): a path that `safeReturnTo` returns unchanged, so it starts with
 * one `/`, not `//`, and holds no `\` or control character. `Button` and `TextLink` both ask it, so they cannot disagree
 * on which links are a `next/link`.
 */
export function isInAppHref(href: string): boolean {
  return safeReturnTo(href) === href;
}
