/**
 * A value a person typed, cleaned before it is validated (issue 102).
 *
 * A tab, LF or CR becomes a space, so "Ana\nMaría" reads "Ana María". Every other control character
 * (Unicode Cc: U+0000-U+001F, U+007F, U+0080-U+009F) and the bidirectional overrides (U+202A-U+202E,
 * U+2066-U+2069) are removed: none is a character a person means to type, and the overrides reorder
 * the text around them in an email or a spreadsheet. Then `.trim()`, last, so it also takes the spaces
 * the cleaning exposed. Runs of spaces are not collapsed.
 *
 * Every other format character stays. The zero-width joiner (U+200D) in particular is part of how
 * emoji sequences and several scripts' names are spelled, so removing it would damage real names.
 */
export function cleanTypedText(value: string): string {
  return value
    .replace(/[\t\n\r]/g, " ")
    .replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, "")
    .trim();
}
