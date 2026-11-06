import { renderEmail } from "./email-templates.js";
import type { Member } from "./members.js";
import type { EmailPort, EmailReceipt } from "./ports/email.js";
import { CODE_TTL_MS, LINK_TTL_MS, type PendingSignInCode } from "./sign-in/code.js";

/** Haul's side of delivery: the pending code, in the member's language, through the email port. */
export function deliverSignInCode(email: EmailPort, pending: PendingSignInCode<Member>): Promise<EmailReceipt> {
  const { subject, text } = renderEmail("signInCode", pending.subject.language, {
    code: pending.code,
    minutes: CODE_TTL_MS / 60_000,
  });
  return email.send({ to: pending.subject.email, subject, text });
}

/** The link email, in the member's language, through the email port. */
export function deliverSignInLink(email: EmailPort, member: Member, url: string): Promise<EmailReceipt> {
  const { subject, text } = renderEmail("signInLink", member.language, { link: url, minutes: LINK_TTL_MS / 60_000 });
  return email.send({ to: member.email, subject, text });
}

/** The site's address and a path, with one slash between them whatever the address ends in. */
export function siteLink(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

/** Where a link's token lands: the one-button page, which redeems nothing until it is pressed. */
export function signInLinkUrl(siteUrl: string, token: string): string {
  return siteLink(siteUrl, `/sign-in/link?token=${token}`);
}
