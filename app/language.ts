import { cookies, headers } from "next/headers";
import { createTranslator, resolveLanguage, type Language, type Translator } from "@core/i18n.js";
import { getSignedInMember } from "./session";

export const LANGUAGE_COOKIE = "lang";

/** The request's language: a signed-in member's own, else the cookie, else the Accept-Language header. */
export async function getLanguage(): Promise<Language> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLanguage({
    member: (await getSignedInMember())?.language,
    cookie: cookieStore.get(LANGUAGE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
}

export async function getTranslator(): Promise<Translator> {
  return createTranslator(await getLanguage());
}
