import { createTranslator, type Language, type MessageKey } from "./i18n.js";

/** Each template's values. The words live in `src/messages/` (DEC-015), never here. */
export type EmailTemplates = { signInCode: { code: string; minutes: number } };

const KEYS = {
  signInCode: { subject: "email.signInCode.subject", body: "email.signInCode.body" },
} as const satisfies Record<keyof EmailTemplates, { subject: MessageKey; body: MessageKey }>;

/** The subject, and the body, a blank line, then the sign-off every email shares. */
export function renderEmail<N extends keyof EmailTemplates>(
  name: N,
  language: Language,
  values: EmailTemplates[N],
): { subject: string; text: string } {
  const t = createTranslator(language);
  const keys = KEYS[name];
  const fill: Record<string, string | number> = values;
  return {
    subject: t(keys.subject, fill),
    text: `${t(keys.body, fill)}\n\n${t("email.signOff")}`,
  };
}
