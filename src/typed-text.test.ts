// Issue 102, AC7–AC9: cleanTypedText, the one home of the rule for a typed value. Every edge case of the rule
// is here; validateAccountDetails (src/create-account.test.ts) and the sign-in request (app/sign-in/actions.test.ts)
// only check that they use it. Each character is written as an escape, so the test says which one it is.
import { describe, expect, it } from "vitest";
import { cleanTypedText } from "./typed-text.js";

const hex = (char: string): string => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

/** Every code point from `from` to `to`, inclusive, as one-character strings. */
const range = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, at) => String.fromCodePoint(from + at));

const TAB_LF_CR = ["\t", "\n", "\r"];
const OTHER_CC = [...range(0x00, 0x1f), "\u007f", ...range(0x80, 0x9f)].filter((char) => !TAB_LF_CR.includes(char));
const BIDI_OVERRIDES = [...range(0x202a, 0x202e), ...range(0x2066, 0x2069)];

describe("AC7 — a tab, LF or CR becomes a space", () => {
  it.each([
    ["a tab", "Ana\tMaría"],
    ["an LF", "Ana\nMaría"],
    ["a CR", "Ana\rMaría"],
  ])("AC7: %s inside a value becomes a space", (_what, typed) => {
    expect(cleanTypedText(typed)).toBe("Ana María");
  });

  it("AC7: a CR+LF becomes two spaces, with no collapsing", () => {
    expect(cleanTypedText("Ana\r\nMaría")).toBe("Ana  María");
  });

  it("AC7: at either end it is trimmed away", () => {
    expect(cleanTypedText("\t\r\nAna María\n\r\t")).toBe("Ana María");
  });
});

describe("AC8 — every other control character and the bidirectional overrides are removed", () => {
  it.each(OTHER_CC.map((char) => [hex(char), char]))("AC8: the control character %s is removed from inside a value", (_code, char) => {
    expect(cleanTypedText(`Ana${char}María`)).toBe("AnaMaría");
  });

  it.each(BIDI_OVERRIDES.map((char) => [hex(char), char]))("AC8: the bidirectional override %s is removed from inside a value", (_code, char) => {
    expect(cleanTypedText(`Ana${char}María`)).toBe("AnaMaría");
  });

  it("AC8: several in a row all go", () => {
    expect(cleanTypedText("Ana\u0000‮\u0007⁦María")).toBe("AnaMaría");
  });

  it.each([
    ["the zero-width joiner U+200D", "‍"],
    ["U+FEFF", "﻿"],
    ["the left-to-right mark U+200E", "‎"],
    ["the right-to-left mark U+200F", "‏"],
    ["U+206A, the format character after the last isolate", "⁪"],
    ["U+202F, the character after the last embedding override", " "],
    ["U+00A0, the character after U+009F", " "],
    ["U+007E, the character before U+007F", "~"],
  ])("AC8: %s stays inside a value", (_what, char) => {
    expect(cleanTypedText(`Ana${char}María`)).toBe(`Ana${char}María`);
  });

  it("AC8: an emoji joined by U+200D comes through whole", () => {
    expect(cleanTypedText("Ana \u{1f469}‍\u{1f4bb}")).toBe("Ana \u{1f469}‍\u{1f4bb}");
  });

  it("AC8: U+FEFF at either end goes with the trim", () => {
    expect(cleanTypedText("﻿Ana María﻿")).toBe("Ana María");
  });

  it("AC8: a value with nothing to clean comes back as typed", () => {
    expect(cleanTypedText("Ana María O'Neil-Ruiz")).toBe("Ana María O'Neil-Ruiz");
  });
});

describe("AC9 — cleaning runs before the trim", () => {
  it("AC9: a control character outside the spaces goes first, so the spaces it hid are trimmed", () => {
    expect(cleanTypedText("\u0000 Ana María ‮")).toBe("Ana María");
  });
});
