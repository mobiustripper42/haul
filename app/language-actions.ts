"use server";

import { cookies } from "next/headers";
import { isLanguage } from "@core/i18n.js";
import { LANGUAGE_COOKIE } from "./language";

const ONE_YEAR_SECONDS = 31_536_000;

/** The switcher's action. Setting a cookie re-renders the current page, so nothing else is needed. */
export async function setLanguage(formData: FormData): Promise<void> {
  const language = formData.get("language");
  if (!isLanguage(language)) return;
  (await cookies()).set(LANGUAGE_COOKIE, language, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    // mill-dev serves plain http, where a secure cookie would never come back.
    secure: process.env.NODE_ENV === "production",
  });
}
