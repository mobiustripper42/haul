/**
 * A return path that stays on this site, or `/`. A path that does not start with `/`, starts with `//`
 * or holds a `\` or a control character (U+0000-U+001F, U+007F) anywhere is never followed: browsers
 * read `/\evil.com` as `//evil.com`, and strip tabs and newlines, so `/<TAB>/evil.com` reads the same.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return "/";
  }
  return value;
}
