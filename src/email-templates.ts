import { createTranslator, type Language, type MessageKey, type Translator } from "./i18n.js";
import { PRIVACY_PATH, TERMS_PATH } from "./legal-documents.js";

/** Each template's values. The words live in `src/messages/` (DEC-015), never here. */
export type EmailTemplates = {
  signInCode: { code: string; minutes: number };
  signInLink: { link: string; minutes: number };
  emailChangeCode: { code: string; minutes: number };
  emailChanged: { email: string };
  // Issue 231: `note` is already rendered, by `noteBlock`: the catalog's note line with its blank line, or the empty string.
  weekClosedCredit: { week: string; note: string };
  weekClosedNoCharge: { week: string; note: string };
  receipt: { amount: string; date: string; week: string };
  weekCreditReceipt: { week: string };
  cardDeclined: { week: string; amount: string; link: string };
  cardLocked: { week: string; link: string };
  // Issue 141: the menu email's `heading` and `pickupLine` are the catalog's `menu.heading` and `menu.pickup`, already rendered.
  menuEmail: { note: string; heading: string; menus: string; meals: string; pickupLine: string; date: string; link: string; offLink: string };
  missingMenu: { weeks: string; weekday: string; link: string };
  // Issue 231: the reminder to admins that a week has no note.
  missingNote: { weeks: string; link: string };
};

const KEYS = {
  signInCode: { subject: "email.signInCode.subject", body: "email.signInCode.body" },
  signInLink: { subject: "email.signInLink.subject", body: "email.signInLink.body" },
  emailChangeCode: { subject: "details.codeEmail.subject", body: "details.codeEmail.body" },
  emailChanged: { subject: "details.changedEmail.subject", body: "details.changedEmail.body" },
  weekClosedCredit: { subject: "email.weekClosed.subject", body: "email.weekClosedCredit.body", closing: "email.signupConfirmation.questions" },
  weekClosedNoCharge: { subject: "email.weekClosed.subject", body: "email.weekClosedNoCharge.body", closing: "email.signupConfirmation.questions" },
  receipt: { subject: "email.receipt.subject", body: "email.receipt.body", closing: "email.signupConfirmation.questions" },
  weekCreditReceipt: { subject: "email.receipt.subject", body: "email.weekCreditReceipt.body", closing: "email.signupConfirmation.questions" },
  cardDeclined: { subject: "email.cardDeclined.subject", body: "email.cardDeclined.body", closing: "email.signupConfirmation.questions" },
  cardLocked: { subject: "email.cardLocked.subject", body: "email.cardLocked.body", closing: "email.signupConfirmation.questions" },
  menuEmail: { subject: "email.menu.subject", body: "email.menu.body", unsubscribe: "email.menu.unsubscribe" },
  missingMenu: { subject: "email.missingMenu.subject", body: "email.missingMenu.body" },
  missingNote: { subject: "email.missingNote.subject", body: "email.missingNote.body" },
} as const satisfies Record<keyof EmailTemplates, { subject: MessageKey; body: MessageKey; closing?: MessageKey; unsubscribe?: MessageKey }>;

/** The site's address and a path, with one slash between them whatever the address ends in. */
export function siteLink(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

/** The two lines every email ends with, in the translator's language: the one home for them (issue 63, AC7). */
export function legalFooter(t: Translator, siteUrl: string): string {
  return [
    t("email.legalTerms", { url: siteLink(siteUrl, TERMS_PATH) }),
    t("email.legalPrivacy", { url: siteLink(siteUrl, PRIVACY_PATH) }),
  ].join("\n");
}

/**
 * Issue 231: the note block a template carries, the one home for the menu email and the two week-closed emails. Null is
 * the empty string, so an email without a note has no stray blank lines. `at` names where the block sits relative to the
 * body: "above" is the line, then a blank line; "below" is a blank line, then the line.
 */
export function noteBlock(line: string | null, at: "above" | "below"): string {
  if (line === null) return "";
  return at === "above" ? `${line}\n\n` : `\n\n${line}`;
}

/** The body, a blank line, then the sign-off every email shares. */
export function withSignOff(t: Translator, body: string): string {
  return `${body}\n\n${t("email.signOff")}`;
}

/**
 * The subject, and the body, a blank line, the template's `closing` line if it has one and a blank line after it, the
 * sign-off every email shares, a blank line, the template's `unsubscribe` line and a blank line after it if it has one
 * (the menu email alone), then the legal footer.
 */
export function renderEmail<N extends keyof EmailTemplates>(
  name: N,
  language: Language,
  values: EmailTemplates[N],
  siteUrl: string,
): { subject: string; text: string } {
  const t = createTranslator(language);
  const keys = KEYS[name];
  const fill: Record<string, string | number> = values;
  const body = t(keys.body, fill);
  return {
    subject: t(keys.subject, fill),
    text: `${withSignOff(t, "closing" in keys ? `${body}\n\n${t(keys.closing, fill)}` : body)}\n\n${"unsubscribe" in keys ? `${t(keys.unsubscribe, fill)}\n\n` : ""}${legalFooter(t, siteUrl)}`,
  };
}
