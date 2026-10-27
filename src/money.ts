// Money is integer cents everywhere, never floats.

/** Returns `value` unchanged if it is a safe integer number of cents; throws a RangeError otherwise. */
export function assertCents(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Expected an integer number of cents, got ${value}`);
  }
  return value;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Formats integer cents as US dollars: 1234 → "$12.34". It takes no locale: every language's
 * `locale` in `LANGUAGES` formats USD as "$12.34" (proved in `src/i18n.test.ts`).
 */
export function formatUsd(cents: number): string {
  // `+ 0` turns -0 into 0, which Intl would otherwise print as "-$0.00".
  return usd.format((assertCents(cents) + 0) / 100);
}
