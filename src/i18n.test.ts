import { describe, expect, it } from "vitest";
import { LANGUAGES, MissingValueError, resolveLanguage, translate, type Catalogs } from "./i18n.js";

describe("AC1 — resolveLanguage: member, then cookie, then Accept-Language, then English", () => {
  it.each([
    [{ member: "es", cookie: "en", acceptLanguage: "en-US" }, "es"],
    [{ member: "en", cookie: "es", acceptLanguage: "es-MX" }, "en"],
    [{ cookie: "es", acceptLanguage: "en-US" }, "es"],
    [{ cookie: "en", acceptLanguage: "es-MX" }, "en"],
    [{ member: null, cookie: "es", acceptLanguage: "en-US" }, "es"],
    [{ acceptLanguage: "es-MX" }, "es"],
    [{ member: null, cookie: null, acceptLanguage: "es-MX" }, "es"],
    [{}, "en"],
    [{ member: null, cookie: null, acceptLanguage: null }, "en"],
  ] as const)("AC1: resolveLanguage(%j) → %j", (input, expected) => {
    expect(resolveLanguage(input)).toBe(expected);
  });
});

describe("AC2 — a cookie that is not a supported code exactly is ignored", () => {
  it("AC2: an unsupported cookie falls through to Accept-Language", () => {
    expect(resolveLanguage({ cookie: "fr", acceptLanguage: "es" })).toBe("es");
  });

  it.each(["fr", "", "ES", "es-MX"])("AC2: cookie %j alone → \"en\"", (cookie) => {
    expect(resolveLanguage({ cookie })).toBe("en");
  });

  it.each(["fr", "", "ES", "es-MX", "EN"])("AC2: cookie %j with Accept-Language \"es\" falls through → \"es\"", (cookie) => {
    expect(resolveLanguage({ cookie, acceptLanguage: "es" })).toBe("es");
  });
});

describe("AC3 — Accept-Language: highest q among supported languages wins", () => {
  it.each([
    ["es-MX,es;q=0.9,en;q=0.8", "es"],
    ["en-US,en;q=0.9,es;q=0.8", "en"],
    ["fr-FR,fr;q=0.9,es;q=0.5", "es"],
    ["en;q=0.5, es;q=0.8", "es"],
    ["es, en", "es"],
    ["en, es", "en"],
    ["es;q=0.5, en;q=0.5", "es"],
    ["en;q=0.5, es;q=0.5", "en"],
    ["ES-mx", "es"],
    ["EN-us", "en"],
    ["es;q=0", "en"],
    ["es;q=0, en;q=0.1", "en"],
    ["fr", "en"],
    ["*", "en"],
    ["*, es;q=0.1", "es"],
    ["", "en"],
    [";;q=,", "en"],
    [";;q=,, es;q=0.3", "es"],
  ])("AC3: Accept-Language %j → %j", (acceptLanguage, expected) => {
    expect(resolveLanguage({ acceptLanguage })).toBe(expected);
  });
});

// The test's own catalogs (the spec has `translate` take them), so AC4 and AC5 don't depend on
// the wording in src/messages/.
const catalogs = {
  en: {
    greeting: "Hello",
    farewell: "Goodbye",
    welcome: "Welcome, {name}",
    twice: "{name} and {name} again",
    count: "{count} boxes",
    pair: "{first} then {second}",
  },
  es: {
    greeting: "Hola",
    welcome: "Bienvenida, {name}",
  },
} satisfies Catalogs<"greeting" | "farewell" | "welcome" | "twice" | "count" | "pair">;

describe("AC4 — translate picks the language, falling back to English for a missing key", () => {
  it("AC4: returns the Spanish string when asked for Spanish", () => {
    expect(translate(catalogs, "es", "greeting")).toBe("Hola");
  });

  it("AC4: returns the English string when asked for English", () => {
    expect(translate(catalogs, "en", "greeting")).toBe("Hello");
  });

  it("AC4: a key absent from the Spanish catalog returns the English string", () => {
    expect(translate(catalogs, "es", "farewell")).toBe("Goodbye");
  });
});

describe("AC5 — placeholders", () => {
  it("AC5: {name} is replaced by the value given for name", () => {
    expect(translate(catalogs, "en", "welcome", { name: "Ada" })).toBe("Welcome, Ada");
    expect(translate(catalogs, "es", "welcome", { name: "Ada" })).toBe("Bienvenida, Ada");
  });

  it("AC5: every occurrence of a placeholder is replaced", () => {
    expect(translate(catalogs, "en", "twice", { name: "Ada" })).toBe("Ada and Ada again");
  });

  it("AC5: several placeholders are each replaced by their own value", () => {
    expect(translate(catalogs, "en", "pair", { first: "soup", second: "bread" })).toBe("soup then bread");
  });

  it.each([
    [3, "3 boxes"],
    [0, "0 boxes"],
    [12.5, "12.5 boxes"],
    [-1, "-1 boxes"],
  ])("AC5: the number %j is rendered with String() → %j", (count, expected) => {
    expect(translate(catalogs, "en", "count", { count })).toBe(expected);
  });

  it("AC5: an empty string is a value, not a missing one", () => {
    expect(translate(catalogs, "en", "welcome", { name: "" })).toBe("Welcome, ");
  });

  it("AC5: values with no placeholder in the string are ignored", () => {
    expect(translate(catalogs, "en", "greeting", { name: "Ada" })).toBe("Hello");
    expect(translate(catalogs, "en", "welcome", { name: "Ada", unused: 7 })).toBe("Welcome, Ada");
  });

  it("AC5: a placeholder with no value throws MissingValueError naming the key and the placeholder", () => {
    let thrown: unknown;
    try {
      translate(catalogs, "en", "pair", { first: "soup" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(MissingValueError);
    expect(thrown).toBeInstanceOf(Error);
    const error = thrown as Error;
    expect(error.name).toBe("MissingValueError");
    expect(error.message).toContain("pair");
    expect(error.message).toContain("second");
  });

  it("AC5: a placeholder throws MissingValueError when no values are given at all", () => {
    expect(() => translate(catalogs, "es", "welcome")).toThrow(MissingValueError);
    expect(() => translate(catalogs, "es", "welcome")).toThrow(/welcome/);
    expect(() => translate(catalogs, "es", "welcome")).toThrow(/name/);
  });
});

describe("AC6 — every language's locale formats US dollars as $12.34", () => {
  const entries = Object.entries(LANGUAGES);

  it("AC6: LANGUAGES is not empty, so the check below is not vacuous", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("AC6: %s carries a locale under which 12.34 USD reads \"$12.34\"", (_code, language) => {
    expect(typeof language.locale).toBe("string");
    const usd = new Intl.NumberFormat(language.locale, { style: "currency", currency: "USD" });
    expect(usd.format(12.34)).toBe("$12.34");
  });
});
