// Issue 64: the Spanish catalog against the English, key by key. Whether a value is Spanish at all is the hand
// check (AC5), not a test: some values are rightly the same in both, so "differs from English" fails correct work.
import { describe, expect, it } from "vitest";
import { type Catalogs, PLACEHOLDER, createTranslator } from "../i18n.js";
import { parseLegalDocument } from "../legal-documents.js";
import { en, type MessageKey } from "./en.js";
import { es } from "./es.js";

const KEYS = Object.keys(en) as MessageKey[];

/** The Spanish catalog as `translate` reads it, so a key it lacks reads as no text rather than a crash. */
const spanish: Catalogs<MessageKey>["es"] = es;
const spanishOf = (key: MessageKey): string => spanish[key] ?? "";

/** The keys whose English and Spanish differ by `of`, each with both sides, so a failure names them. */
function differences(of: (text: string) => string[]): Record<string, { en: string[]; es: string[] }> {
  const found: Record<string, { en: string[]; es: string[] }> = {};
  for (const key of KEYS) {
    const english = of(en[key]);
    const translated = of(spanishOf(key));
    if (JSON.stringify(english) !== JSON.stringify(translated)) found[key] = { en: english, es: translated };
  }
  return found;
}

/** The placeholder names `translate` fills in `text`, as a set: each once, sorted. */
const placeholders = (text: string): string[] =>
  [...new Set(Array.from(text.matchAll(PLACEHOLDER), (match) => match[1] ?? ""))].sort();

/** The bracketed fill-ins in `text`, `[CONTACT EMAIL]` and the like, as many times as each appears, sorted. */
const fillIns = (text: string): string[] => Array.from(text.matchAll(/\[[^\]\n]*\]/g), (match) => match[0]).sort();

describe("AC1 — the same keys", () => {
  it("AC1: es.ts has every key en.ts has, and none it lacks", () => {
    const missing = KEYS.filter((key) => !Object.hasOwn(es, key));
    const extra = Object.keys(es).filter((key) => !Object.hasOwn(en, key));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
});

describe("AC2 — the same placeholders", () => {
  it("AC2: every Spanish string has its English string's set of {placeholders}: none renamed, dropped or added", () => {
    expect(differences(placeholders)).toEqual({});
  });

  it("AC2: the placeholders compared are the ones translate fills: given a value for each, it asks for no other and leaves none behind", () => {
    const unfilled: Record<string, string> = {};
    for (const key of KEYS) {
      const names = placeholders(en[key]);
      const values = Object.fromEntries(names.map((name) => [name, `«${name}»`]));
      try {
        const text = createTranslator("en")(key, values);
        const left = names.filter((name) => text.includes(`{${name}}`));
        if (left.length > 0) unfilled[key] = `left ${left.join(", ")}`;
      } catch (error) {
        unfilled[key] = String(error);
      }
    }
    expect(unfilled).toEqual({});
  });
});

describe("AC3 — the same bracketed fill-ins", () => {
  it("AC3: every Spanish string carries its English string's fill-ins unchanged, as many times each, and no other", () => {
    expect(differences(fillIns)).toEqual({});
  });
});

describe("AC4 — the legal texts keep their shape", () => {
  /** The blocks' kinds in order, a list with its length: what the Terms and Privacy pages draw, without the words. */
  const shape = (text: string): string[] =>
    parseLegalDocument(text).map((block) => (block.kind === "list" ? `list of ${block.items.length}` : block.kind));

  it.each(["legal.terms.text", "legal.privacy.text"] as const)(
    "AC4: the Spanish %s parses into the English's blocks: the same kinds in order, each list as long",
    (key) => {
      expect(shape(spanishOf(key))).toEqual(shape(en[key]));
    },
  );
});
