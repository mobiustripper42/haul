import { headers } from "next/headers";
import { createTranslator, preferredLanguage, type Language, type Translator } from "@core/i18n.js";

/**
 * The language every screen renders in: English, whoever asks (DEC-043). The one place screens ask, so a
 * later "screens follow X" is a change here. A member's saved language picks only the language of their email.
 */
export async function getLanguage(): Promise<Language> {
  return "en";
}

/** The default of "Language for emails": the browser's preferred language if the app has it, else English. */
export async function getEmailLanguageDefault(): Promise<Language> {
  return preferredLanguage((await headers()).get("accept-language"));
}

export async function getTranslator(): Promise<Translator> {
  return createTranslator(await getLanguage());
}
