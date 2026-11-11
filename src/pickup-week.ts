import { LANGUAGES, type Language, type Translator } from "./i18n.js";
import type { ProductWithOptions } from "./products.js";

/** A pickup week: its ordinary Sunday, the week's key (DEC-031), and the days it is picked up, all `YYYY-MM-DD`. */
export type PickupWeek = { weekOf: string; firstDay: string; lastDay: string };

/** A week an admin changed (`pickup_weeks`): closed when `closedAt` is set, moved when `firstDay`/`lastDay` are. */
export type ChangedWeek = { weekOf: string; closedAt: Date | null; note: string | null; firstDay: string | null; lastDay: string | null };

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
 * A Sunday key and its changed row as a week: an ordinary week is its Sunday and the Monday after, a moved week
 * its `firstDay` and `lastDay`. The one home for that default; callers never add a day themselves.
 */
export function pickupWeek(weekOf: string, changed: ChangedWeek | null): PickupWeek {
  if (changed?.firstDay != null && changed.lastDay != null) return { weekOf, firstDay: changed.firstDay, lastDay: changed.lastDay };
  return { weekOf, firstDay: weekOf, lastDay: addDays(weekOf, 1) };
}

/**
 * The first Sunday on or after the product's first pickup date whose cutoff has not passed (docs/SPEC.md §7.2,
 * §7.3), and that is not closed in `changed`, as a week. A Sunday's cutoff is the product's cutoff weekday and
 * time, on the latest such weekday on or before it. The cutoff is the ordinary Sunday's whatever `changed` says:
 * a week closed or moved after its cutoff has passed was already skipped by the cutoff.
 */
export function firstPickup(product: ProductWithOptions, now: Date, changed: ChangedWeek[]): PickupWeek {
  const first = product.firstPickupDate;
  const isoWeekday = new Date(`${first}T00:00:00Z`).getUTCDay() || 7;
  let sunday = addDays(first, (7 - isoWeekday) % 7);
  const cutoffOf = (pickup: string): number => clevelandInstant(addDays(pickup, product.cutoffWeekday - 7), product.cutoffTime);

  // Weeks long past are skipped in one step, a week short of the answer.
  const weeksBehind = Math.floor((now.getTime() - cutoffOf(sunday)) / (7 * DAY_MS)) - 1;
  if (weeksBehind > 0) sunday = addDays(sunday, weeksBehind * 7);

  while (now.getTime() >= cutoffOf(sunday)) sunday = addDays(sunday, 7);

  const byWeek = new Map(changed.map((week) => [week.weekOf, week]));
  while (byWeek.get(sunday)?.closedAt != null) sunday = addDays(sunday, 7);
  return pickupWeek(sunday, byWeek.get(sunday) ?? null);
}

/** A date's weekday as a word, as the locale writes it: "Saturday", "sábado". `pickupWhereLine` capitalises the line. */
function weekdayName(date: string, language: Language): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(LANGUAGES[language].locale, { weekday: "long", timeZone: "UTC" });
}

/**
 * The done box's and the email's "where and when" line: today's line for an ordinary week, and a line naming
 * the days for a moved one (one day, or two).
 */
export function pickupWhereLine(t: Translator, week: PickupWeek, language: Language): string {
  if (week.firstDay === week.weekOf && week.lastDay === addDays(week.weekOf, 1)) return t("supperClub.box.pickupWhere");
  const line =
    week.firstDay === week.lastDay
      ? t("supperClub.box.pickupWhereMovedOneDay", { day: weekdayName(week.firstDay, language) })
      : t("supperClub.box.pickupWhereMoved", { first: weekdayName(week.firstDay, language), last: weekdayName(week.lastDay, language) });
  // Spanish weekday names come lowercase, and the line starts with one.
  return line.charAt(0).toLocaleUpperCase(LANGUAGES[language].locale) + line.slice(1);
}

/** "First pickup: {date}", with the week's first day: the one home for the done box and the email. */
export function firstPickupLine(t: Translator, week: PickupWeek, language: Language): string {
  return t("supperClub.box.firstPickup", { date: formatPickupDate(week.firstDay, language) });
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

/** `instant`'s date on Cleveland's wall clock, `YYYY-MM-DD`. */
export function clevelandDate(instant: Date): string {
  const part = Object.fromEntries(wallClock.formatToParts(instant).map(({ type, value }) => [type, value]));
  return `${part.year}-${String(part.month).padStart(2, "0")}-${String(part.day).padStart(2, "0")}`;
}

/** A date as a short label: "Dec 1". */
export function formatShortDate(date: string, language: Language): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(LANGUAGES[language].locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
