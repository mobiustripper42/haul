import { renderEmail } from "./email-templates.js";
import type { Member } from "./members.js";
import type { EmailPort, EmailReceipt } from "./ports/email.js";
import { CODE_TTL_MS, type PendingSignInCode } from "./sign-in/code.js";

/** Haul's side of delivery: the pending code, in the member's language, through the email port. */
export function deliverSignInCode(email: EmailPort, pending: PendingSignInCode<Member>): Promise<EmailReceipt> {
  const { subject, text } = renderEmail("signInCode", pending.subject.language, {
    code: pending.code,
    minutes: CODE_TTL_MS / 60_000,
  });
  return email.send({ to: pending.subject.email, subject, text });
}
