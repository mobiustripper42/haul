import { cookies, headers } from "next/headers";
import { createTranslator, resolveLanguage, type Language, type Translator } from "@core/i18n.js";

export const LANGUAGE_COOKIE = "lang";

/**
 * The request's language: the cookie the switch sets, else the Accept-Language header, signed in or not.
 * A member's saved language picks only the language of their email.
 */
export async function getLanguage(): Promise<Language> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLanguage({
    cookie: cookieStore.get(LANGUAGE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
}

export async function getTranslator(): Promise<Translator> {
  return createTranslator(await getLanguage());
}
