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

export const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * A Sunday key and its changed row as a week: an ordinary week is its Sunday and the Monday after, a moved week
 * its `firstDay` and `lastDay`. The one home for that default; callers never add a day themselves.
 */
export function pickupWeek(weekOf: string, changed: ChangedWeek | null): PickupWeek {
  if (changed?.firstDay != null && changed.lastDay != null) return { weekOf, firstDay: changed.firstDay, lastDay: changed.lastDay };
  return { weekOf, firstDay: weekOf, lastDay: addDays(weekOf, 1) };
}

/** The first Sunday on or after the product's first pickup date: the first week the product has. */
function firstSunday(product: ProductWithOptions): string {
  const isoWeekday = new Date(`${product.firstPickupDate}T00:00:00Z`).getUTCDay() || 7;
  return addDays(product.firstPickupDate, (7 - isoWeekday) % 7);
}

/**
 * The date of a week's cutoff: the product's cutoff weekday on or before the week's Sunday (`weekOf`). The
 * "Monday" in every "end of Monday" the calendar shows, and the date `checkMove` compares against; not the date
 * of `cutoffInstant`, which for a `24:00` cutoff falls on the next day.
 */
export function cutoffDate(product: ProductWithOptions, weekOf: string): string {
  return addDays(weekOf, product.cutoffWeekday - 7);
}

/** The instant a week's cutoff passes: the end of `cutoffDate`'s day for a `24:00` cutoff, in Cleveland. */
export function cutoffInstant(product: ProductWithOptions, weekOf: string): Date {
  return new Date(clevelandInstant(cutoffDate(product, weekOf), product.cutoffTime));
}

/** The first Sunday on or after the product's first Sunday whose cutoff has not passed at `now`, closed or not. */
function firstSundayOpenAt(product: ProductWithOptions, now: Date): string {
  let sunday = firstSunday(product);
  const cutoffOf = (pickup: string): number => cutoffInstant(product, pickup).getTime();

  // Weeks long past are skipped in one step, a week short of the answer.
  const weeksBehind = Math.floor((now.getTime() - cutoffOf(sunday)) / (7 * DAY_MS)) - 1;
  if (weeksBehind > 0) sunday = addDays(sunday, weeksBehind * 7);

  while (now.getTime() >= cutoffOf(sunday)) sunday = addDays(sunday, 7);
  return sunday;
}

/**
 * The first Sunday on or after the product's first pickup date whose cutoff has not passed (docs/SPEC.md §7.2,
 * §7.3), and that is not closed in `changed`, as a week. A Sunday's cutoff is the product's cutoff weekday and
 * time, on the latest such weekday on or before it. The cutoff is the ordinary Sunday's whatever `changed` says:
 * a week closed or moved after its cutoff has passed was already skipped by the cutoff.
 */
export function firstPickup(product: ProductWithOptions, now: Date, changed: ChangedWeek[]): PickupWeek {
  let sunday = firstSundayOpenAt(product, now);
  const byWeek = new Map(changed.map((week) => [week.weekOf, week]));
  while (byWeek.get(sunday)?.closedAt != null) sunday = addDays(sunday, 7);
  return pickupWeek(sunday, byWeek.get(sunday) ?? null);
}

/**
 * The latest Sunday key on or after the product's first Sunday whose `cutoffInstant` is at or before `now`, closed or
 * not (issue 134, DEC-034): the one week the charge run enrols. Null when none has passed.
 */
export function latestCutoffWeek(product: ProductWithOptions, now: Date): string | null {
  const latest = addDays(firstSundayOpenAt(product, now), -7);
  return latest >= firstSunday(product) ? latest : null;
}

/** Whether the week's last pickup day is before `today`, a Cleveland date (`YYYY-MM-DD`): its pickup is over. */
export function pickupOver(week: PickupWeek, today: string): boolean {
  return week.lastDay < today;
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
  if (!isMoved(week)) return t("supperClub.box.pickupWhere");
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

/**
 * A week as the admin's calendar shows it (docs/SPEC.md §7.2): its days, its cutoff instant, what `pickup_weeks`
 * holds for it, and what the screen may offer. Issue 149.
 */
export type AdminWeek = PickupWeek & {
  cutoff: Date;
  closedAt: Date | null;
  note: string | null;
  moved: boolean;
  cutoffPassed: boolean;
  canReopen: boolean;
};

/** A member's next pickup: the first of `weeks` not closed and with `weekOf >= firstWeek`; null when there is none. */
export function nextPickup(weeks: AdminWeek[], firstWeek: string): PickupWeek | null {
  return weeks.find((week) => week.closedAt === null && week.weekOf >= firstWeek) ?? null;
}

/** Whether a week's days are not its ordinary ones, the Sunday and the Monday after. */
export function isMoved(week: PickupWeek): boolean {
  return week.firstDay !== week.weekOf || week.lastDay !== addDays(week.weekOf, 1);
}

/** A date as its month and day, as the locale writes them: "January 17", "17 de enero". */
function monthDay(date: string, language: Language): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(LANGUAGES[language].locale, { month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * A week's days as a title: an ordinary week is its two dates ("January 17 and 18"), a moved one names its days
 * ("Saturday, February 6 and Sunday, February 7"), and a one-day week says so ("Sunday, February 7 only").
 */
export function weekTitle(t: Translator, week: PickupWeek, language: Language): string {
  if (isMoved(week)) {
    if (week.firstDay === week.lastDay) return t("admin.weeks.titleOneDay", { day: formatPickupDate(week.firstDay, language) });
    return t("admin.weeks.titleTwoDays", { first: formatPickupDate(week.firstDay, language), last: formatPickupDate(week.lastDay, language) });
  }
  if (week.firstDay.slice(0, 7) !== week.lastDay.slice(0, 7)) {
    return t("admin.weeks.titleTwoDays", { first: monthDay(week.firstDay, language), last: monthDay(week.lastDay, language) });
  }
  return t("admin.weeks.titleSameMonth", {
    month: new Date(`${week.firstDay}T00:00:00Z`).toLocaleDateString(LANGUAGES[language].locale, { month: "long", timeZone: "UTC" }),
    first: Number(week.firstDay.slice(8)),
    last: Number(week.lastDay.slice(8)),
  });
}

/** How many weeks the admin's calendar lists. */
const CALENDAR_WEEKS = 12;

/** A week as the admin's calendar shows it: its days, its cutoff, what `pickup_weeks` holds for it, and what the screen may offer. */
function adminWeek(product: ProductWithOptions, now: Date, byWeek: Map<string, ChangedWeek>, weekOf: string): AdminWeek {
  const week = pickupWeek(weekOf, byWeek.get(weekOf) ?? null);
  const row = byWeek.get(weekOf);
  const cutoff = cutoffInstant(product, weekOf);
  const cutoffPassed = now.getTime() >= cutoff.getTime();
  const closedAt = row?.closedAt ?? null;
  return { ...week, cutoff, closedAt, note: row?.note ?? null, moved: isMoved(week), cutoffPassed, canReopen: closedAt !== null && !cutoffPassed };
}

/** The earliest week whose last pickup day has not passed in Cleveland: the current week, as the calendar starts. */
function currentSunday(product: ProductWithOptions, today: string, byWeek: Map<string, ChangedWeek>): string {
  let sunday = firstSunday(product);
  // Weeks long past are skipped in one step, two short of the answer: a week's last day is at most 8 days after its Sunday.
  const weeksBehind = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${sunday}T00:00:00Z`)) / (7 * DAY_MS)) - 2;
  if (weeksBehind > 0) sunday = addDays(sunday, weeksBehind * 7);
  while (pickupOver(pickupWeek(sunday, byWeek.get(sunday) ?? null), today)) sunday = addDays(sunday, 7);
  return sunday;
}

/**
 * The weeks the admin's calendar lists (docs/SPEC.md §7.2): 12, from the earliest whose last pickup day has not
 * passed in Cleveland (the moved last day for a moved week), so a week past its cutoff and before its pickup is
 * still listed. Never a week before the product's first pickup date. A closed week keeps its move. With `from`, a
 * member's first week, the 12 start at the later of `from` and that week.
 */
export function upcomingWeeks(product: ProductWithOptions, now: Date, changed: ChangedWeek[], from?: string): AdminWeek[] {
  const byWeek = new Map(changed.map((week) => [week.weekOf, week]));
  const current = currentSunday(product, clevelandDate(now), byWeek);
  const sunday = from !== undefined && from > current ? from : current;
  return Array.from({ length: CALENDAR_WEEKS }, (_, i) => adminWeek(product, now, byWeek, addDays(sunday, i * 7)));
}

/**
 * The weeks a member's History lists (issue 155): every week from `from` up to the latest whose last pickup day
 * has passed in Cleveland, newest first, each built as `upcomingWeeks` builds them; never a week before the
 * product's first pickup date.
 */
export function pastWeeks(product: ProductWithOptions, now: Date, changed: ChangedWeek[], from: string): AdminWeek[] {
  const byWeek = new Map(changed.map((week) => [week.weekOf, week]));
  const current = currentSunday(product, clevelandDate(now), byWeek);
  const first = from > firstSunday(product) ? from : firstSunday(product);
  const weeks: AdminWeek[] = [];
  for (let sunday = first; sunday < current; sunday = addDays(sunday, 7)) weeks.push(adminWeek(product, now, byWeek, sunday));
  return weeks.reverse();
}

/** A listed week's title (issue 155): a closed week carries its ordinary days, its move waiting for a reopen. */
export function listedWeekTitle(t: Translator, week: AdminWeek, language: Language): string {
  return weekTitle(t, week.closedAt === null ? week : pickupWeek(week.weekOf, null), language);
}

/** A real calendar date, `YYYY-MM-DD`: what a date input sends, and not a string that merely looks like one (`2026-02-32`). */
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** The next week's cutoff date: where a move's last day must stop, so two weeks cannot overlap. */
export function nextCutoffDate(product: ProductWithOptions, weekOf: string): string {
  return cutoffDate(product, addDays(weekOf, 7));
}

/**
 * Whether a week's pickup days may be `firstDay` and `lastDay` (docs/SPEC.md §7.2): the first after the week's
 * cutoff date, the last not before the first, and the last no later than the next week's cutoff date, so two
 * weeks cannot overlap. One fault, in that order.
 */
export function checkMove(
  product: ProductWithOptions,
  weekOf: string,
  firstDay: string,
  lastDay: string,
): "ok" | "beforeCutoff" | "order" | "overlapsNext" {
  if (firstDay <= cutoffDate(product, weekOf)) return "beforeCutoff";
  if (lastDay < firstDay) return "order";
  if (lastDay > nextCutoffDate(product, weekOf)) return "overlapsNext";
  return "ok";
}

/** A date as a short label: "Dec 1". */
export function formatShortDate(date: string, language: Language): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(LANGUAGES[language].locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
