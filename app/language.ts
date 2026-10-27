import { cookies, headers } from "next/headers";
import { createTranslator, resolveLanguage, type Language, type Translator } from "@core/i18n.js";

export const LANGUAGE_COOKIE = "lang";

/** The request's language from the cookie and the Accept-Language header. No member yet: there is no session until task 0.6. */
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
