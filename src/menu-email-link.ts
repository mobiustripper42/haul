// Issue 141 (AC8), issue 186 (DEC-039): the menu email's off link. The member id plus an HMAC under the session secret of
// the id behind a purpose prefix, the signing the session cookie uses; no column and no expiry, so a link in an old email
// still turns the email off. The prefix holds a `:`, which base64url never does, so the cookie's signed payload part can
// never equal what an off token signs.
import { MENU_EMAILS_OFF_PATH, MENU_EMAILS_PATH } from "./menu-email-paths.js";
import { sign, signatureMatches } from "./sign-in/session.js";

const MENU_EMAIL_TOKEN_PREFIX = "menu-emails-off:";

// Core cannot import `app/`, so the paths live in core and `app/paths.ts` imports them (from their own file, which a client component can reach).
export { MENU_EMAILS_OFF_PATH, MENU_EMAILS_PATH };

/** The member's token: base64url, the same every time. */
export function menuEmailToken(memberId: string, secret: string): string {
  return sign(MENU_EMAIL_TOKEN_PREFIX + memberId, secret);
}

/** Whether the token is the member's under the secret, in constant time; a token of any other length is a plain no. */
export function menuEmailTokenMatches(memberId: string, token: string, secret: string): boolean {
  return signatureMatches(token, menuEmailToken(memberId, secret));
}

/** The off link as the email carries it: the route under the site's address, naming the member and carrying the token. */
export function menuEmailOffLink(siteUrl: string, memberId: string, secret: string): string {
  const query = new URLSearchParams({ m: memberId, t: menuEmailToken(memberId, secret) });
  return `${siteUrl.replace(/\/$/, "")}${MENU_EMAILS_OFF_PATH}?${query.toString()}`;
}
