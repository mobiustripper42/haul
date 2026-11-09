import { DEFAULT_LANGUAGE, isLanguage, type Language } from "./i18n.js";
import type { Member } from "./members.js";
import type { Repository } from "./ports/repository.js";
import { issueSignInCode, type IssueOutcome } from "./sign-in/code.js";
import { cleanTypedText } from "./typed-text.js";

export type AccountField = "firstName" | "lastName" | "email" | "phone";

export type AccountDetails = { email: string; firstName: string; lastName: string; phone: string; language: Language };

/** The longest each value may be, after trimming: the email index's, and sane for the rest. The page's `maxLength`s and the draft cookie use these too. */
export const ACCOUNT_LIMITS = { firstName: 100, lastName: 100, email: 254, phone: 40 } as const satisfies Record<AccountField, number>;

/**
 * Valid when it has no whitespace, exactly one `@`, a non-empty part before it, and a part after it
 * with at least one `.` and a non-empty label on each side of every `.`.
 */
function isValidEmail(email: string): boolean {
  if (/\s/.test(email)) return false;
  const parts = email.split("@");
  const [local, domain] = parts;
  if (parts.length !== 2 || !local || !domain) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => label !== "");
}

/** The details step's whole rule: each value cleaned (`cleanTypedText`) and trimmed, the failing fields in form order. */
export function validateAccountDetails(input: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  language: string;
}): { ok: true; details: AccountDetails } | { ok: false; errors: AccountField[] } {
  const firstName = cleanTypedText(input.firstName);
  const lastName = cleanTypedText(input.lastName);
  const email = cleanTypedText(input.email);
  const phone = cleanTypedText(input.phone);
  const language = input.language.trim();

  const errors: AccountField[] = [];
  if (firstName === "" || firstName.length > ACCOUNT_LIMITS.firstName) errors.push("firstName");
  if (lastName === "" || lastName.length > ACCOUNT_LIMITS.lastName) errors.push("lastName");
  if (!isValidEmail(email) || email.length > ACCOUNT_LIMITS.email) errors.push("email");
  if (phone === "" || phone.length > ACCOUNT_LIMITS.phone) errors.push("phone");
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    details: { email, firstName, lastName, phone, language: isLanguage(language) ? language : DEFAULT_LANGUAGE },
  };
}

/**
 * Run after the response, so a new email, an unconfirmed member and a confirmed one all answer alike
 * (AC11): saves the account (`saveAccount` inserts, replaces or leaves it alone), then issues the
 * ordinary sign-in code for that member, in one `withActor(null)` so a failure keeps neither.
 */
export async function issueAccountCode(
  repo: Repository,
  details: AccountDetails,
  pending: { code: string; codeHash: string },
  deps: { now: Date; mintLinkToken: () => string },
): Promise<{ member: Member; outcome: IssueOutcome }> {
  return repo.withActor(null, async (scoped) => {
    const member = await scoped.saveAccount(details);
    const outcome = await issueSignInCode(scoped, { subject: member, ...pending }, deps);
    return { member, outcome };
  });
}
