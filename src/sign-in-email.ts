import { renderEmail, siteLink } from "./email-templates.js";
import type { Member } from "./members.js";
import type { EmailPort, EmailReceipt } from "./ports/email.js";
import { CODE_TTL_MS, LINK_TTL_MS, type PendingSignInCode } from "./sign-in/code.js";

/** Haul's side of delivery: the pending code, in the member's language, through the email port. */
export function deliverSignInCode(
  email: EmailPort,
  pending: PendingSignInCode<Member>,
  siteUrl: string,
): Promise<EmailReceipt> {
  const { subject, text } = renderEmail(
    "signInCode",
    pending.subject.language,
    { code: pending.code, minutes: CODE_TTL_MS / 60_000 },
    siteUrl,
  );
  return email.send({ to: pending.subject.email, subject, text });
}

/** The link email, in the member's language, through the email port. */
export function deliverSignInLink(email: EmailPort, member: Member, url: string, siteUrl: string): Promise<EmailReceipt> {
  const { subject, text } = renderEmail("signInLink", member.language, { link: url, minutes: LINK_TTL_MS / 60_000 }, siteUrl);
  return email.send({ to: member.email, subject, text });
}

/**
 * The code that confirms an email change (issue 156), to the new address, in the member's email language:
 * sign-in's code email builder with its own subject and sentence.
 */
export function deliverEmailChangeCode(
  email: EmailPort,
  change: { member: Member; newEmail: string; code: string },
  siteUrl: string,
): Promise<EmailReceipt> {
  const { subject, text } = renderEmail("emailChangeCode", change.member.language, { code: change.code, minutes: CODE_TTL_MS / 60_000 }, siteUrl);
  return email.send({ to: change.newEmail, subject, text });
}

/** The notice to the old address once a change is confirmed, naming the new one, in the member's email language. */
export function deliverEmailChangedNotice(
  email: EmailPort,
  change: { member: Member; oldEmail: string; newEmail: string },
  siteUrl: string,
): Promise<EmailReceipt> {
  const { subject, text } = renderEmail("emailChanged", change.member.language, { email: change.newEmail }, siteUrl);
  return email.send({ to: change.oldEmail, subject, text });
}

/** Where a link's token lands: the one-button page, which redeems nothing until it is pressed. */
export function signInLinkUrl(siteUrl: string, token: string): string {
  return siteLink(siteUrl, `/sign-in/link?token=${token}`);
}
