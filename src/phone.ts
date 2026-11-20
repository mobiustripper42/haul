// Issue 222: the phone's three rules, each in one place — what the server keeps (`phoneDigits`), how a stored phone
// displays (`formatPhone`), how the box formats while typing (`formatPhoneTyping`).

/** Every non-digit removed. The members search matches a phone on this too (src/member-list.ts). */
export const digitsOf = (text: string): string => text.replace(/\D/g, "");

/** The `(216) 555-1234` shape of ten digits. */
const TEN_DIGITS = /^(\d{3})(\d{3})(\d{4})$/;

/** The ten digits the server keeps: eleven starting with `1` lose the `1`; anything else is null. */
export function phoneDigits(typed: string): string | null {
  const digits = digitsOf(typed);
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

/** A stored phone as shown: ten bare digits as `(216) 555-1234`; null as `""`; anything else, saved before this rule, unchanged. */
export function formatPhone(phone: string | null): string {
  if (phone === null) return "";
  return phone.replace(TEN_DIGITS, "($1) $2-$3");
}

/** The phone box's value as typed: the digits, a leading `1` dropped, the first ten, partly formatted. */
export function formatPhoneTyping(typed: string): string {
  const all = digitsOf(typed);
  const digits = (all.startsWith("1") ? all.slice(1) : all).slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length === 10) return formatPhone(digits);
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
