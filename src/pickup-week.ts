import { LANGUAGES, type Language } from "./i18n.js";
import type { ProductWithOptions } from "./products.js";

/** Cutoffs and pickup days are Cleveland's wall clock (DEC-017). */
const ZONE = "America/New_York";

const DAY_MS = 24 * 60 * 60 * 1000;

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** How far Cleveland's clock is from UTC at `instant`, in milliseconds (negative: behind). */
function offsetAt(instant: number): number {
  const at = new Date(Math.floor(instant / 1000) * 1000);
  const part = Object.fromEntries(wallClock.formatToParts(at).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(part.year ?? 0, (part.month ?? 1) - 1, part.day ?? 1, part.hour, part.minute, part.second) - at.getTime();
}

/** The instant a Cleveland wall clock reads `date` at `time`; "24:00:00" is the end of that day. */
function clevelandInstant(date: string, time: string): number {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // The offset is read at the guess, so a wall time just across a clock change settles in two passes.
  let instant = wall;
  for (let pass = 0; pass < 2; pass++) instant = wall - offsetAt(instant);
  return instant;
}

const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The local date of the first Sunday on or after the product's first pickup date whose cutoff has not
 * passed (docs/SPEC.md §7.2, §7.3). A Sunday's cutoff is the product's cutoff weekday and time, on the
 * latest such weekday on or before it.
 */
export function firstPickup(product: ProductWithOptions, now: Date): string {
  const first = product.firstPickupDate;
  const isoWeekday = new Date(`${first}T00:00:00Z`).getUTCDay() || 7;
  let sunday = addDays(first, (7 - isoWeekday) % 7);
  const cutoffOf = (pickup: string): number => clevelandInstant(addDays(pickup, product.cutoffWeekday - 7), product.cutoffTime);

  // Weeks long past are skipped in one step, a week short of the answer.
  const weeksBehind = Math.floor((now.getTime() - cutoffOf(sunday)) / (7 * DAY_MS)) - 1;
  if (weeksBehind > 0) sunday = addDays(sunday, weeksBehind * 7);

  while (now.getTime() >= cutoffOf(sunday)) sunday = addDays(sunday, 7);
  return sunday;
}

/** A pickup date as words: "Sunday, January 3". */
export function formatPickupDate(date: string, language: Language): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(LANGUAGES[language].locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
