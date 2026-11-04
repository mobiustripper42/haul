/**
 * A return path that stays on this site, or `/`. A path that does not start with `/`, starts with `//`
 * or holds a `\` anywhere is never followed: browsers read `/\evil.com` as `//evil.com`.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}
