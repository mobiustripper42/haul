// Money is integer cents everywhere, never floats.

/** Returns `value` unchanged if it is a safe integer number of cents; throws a RangeError otherwise. */
export function assertCents(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Expected an integer number of cents, got ${value}`);
  }
  return value;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Formats integer cents as US dollars: 1234 → "$12.34". The locale parameter arrives with i18n. */
export function formatUsd(cents: number): string {
  return usd.format(assertCents(cents) / 100);
}
