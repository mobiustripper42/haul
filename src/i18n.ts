import { en, type MessageKey } from "./messages/en.js";
import { es } from "./messages/es.js";

export type { MessageKey };

/**
 * Each language is named in itself. `locale` is what every `Intl` formatter gets, never the bare
 * code: bare "es" formats US dollars as "12,34 US$", "es-US" as "$12.34".
 */
export const LANGUAGES = {
  en: { name: "English", locale: "en-US" },
  es: { name: "Español", locale: "es-US" },
} as const;

export type Language = keyof typeof LANGUAGES;

export const DEFAULT_LANGUAGE: Language = "en";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.hasOwn(LANGUAGES, value);
}

/** The language's best match in an `Accept-Language` header: highest q, ties to the first listed. */
function fromAcceptLanguage(header: string): Language | null {
  let best: { language: Language; q: number } | null = null;
  for (const entry of header.split(",")) {
    const [range = "", ...params] = entry.split(";");
    const tag = range.trim().toLowerCase();
    if (tag === "" || tag === "*") continue;
    const language = tag.split("-")[0];
    if (!isLanguage(language)) continue;
    let q = 1;
    const qParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith("q="));
    if (qParam !== undefined) {
      q = Number(qParam.slice(2));
      if (!Number.isFinite(q)) continue;
    }
    if (q <= 0) continue;
    if (best === null || q > best.q) best = { language, q };
  }
  return best?.language ?? null;
}

/** The member's preference, else the cookie, else `Accept-Language`, else English. */
export function resolveLanguage(input: {
  member?: Language | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Language {
  if (input.member) return input.member;
  if (isLanguage(input.cookie)) return input.cookie;
  if (input.acceptLanguage) {
    const match = fromAcceptLanguage(input.acceptLanguage);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}

export type Catalogs<K extends string> = { en: Readonly<Record<K, string>> } & {
  [L in Exclude<Language, "en">]: Readonly<Partial<Record<K, string>>>;
};

export class MissingValueError extends Error {
  constructor(key: string, placeholder: string) {
    super(`Message "${key}" needs a value for {${placeholder}}`);
    this.name = "MissingValueError";
  }
}

/** The string for `key` in `language`, English where that language lacks it, placeholders filled. */
export function translate<K extends string>(
  catalogs: Catalogs<K>,
  language: Language,
  key: NoInfer<K>,
  values?: Record<string, string | number>,
): string {
  const catalog: Readonly<Partial<Record<K, string>>> = catalogs[language];
  const text = catalog[key] ?? catalogs.en[key];
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values !== undefined && Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined) throw new MissingValueError(key, name);
    return String(value);
  });
}

export type Translator = (key: MessageKey, values?: Record<string, string | number>) => string;

export function createTranslator(language: Language): Translator {
  return (key, values) => translate({ en, es }, language, key, values);
}
