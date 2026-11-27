// Issue 56, AC3 and AC13: the first pickup a signup pays for, read from the product's settings in Cleveland
// time, and a pickup date in words.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "./i18n.js";
import { en } from "./messages/en.js";
import {
  addDays,
  clevelandDate,
  defaultListedWeek,
  firstPickup,
  firstPickupLine,
  formatPickupDate,
  formatShortDate,
  latestCutoffWeek,
  listableWeeks,
  listedWeekTitle,
  menuEmailDate,
  nextPickup,
  pastWeeks,
  pickupWeek,
  pickupWhereLine,
  upcomingWeeks,
  weeksFrom,
  weekTitle,
  type AdminWeek,
  type ChangedWeek,
} from "./pickup-week.js";
import type { ProductWithOptions } from "./products.js";

const product = (over: Partial<ProductWithOptions> = {}): ProductWithOptions => ({
  id: "product",
  name: "Supper Club",
  cap: 50,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes: [],
  ...over,
});

describe("AC3 — the first pickup", () => {
  it("AC3: at 23:59 on Monday 2026-12-28, Cleveland time, it is January 3", () => {
    expect(firstPickup(product(), new Date("2026-12-29T04:59:00.000Z"), []).weekOf).toBe("2027-01-03");
  });

  it("AC3: a minute later it is January 10", () => {
    expect(firstPickup(product(), new Date("2026-12-29T05:00:00.000Z"), []).weekOf).toBe("2027-01-10");
  });

  it("AC3: long before the first pickup date it is the first pickup date", () => {
    expect(firstPickup(product(), new Date("2026-11-06T15:00:00.000Z"), []).weekOf).toBe("2027-01-03");
  });

  it("AC3: a first pickup date that is not a Sunday gives the first Sunday after it", () => {
    expect(firstPickup(product({ firstPickupDate: "2027-01-05" }), new Date("2026-11-06T15:00:00.000Z"), []).weekOf).toBe("2027-01-10");
  });

  it("AC3: well after the first pickup date, the Monday before a Sunday still catches that Sunday", () => {
    expect(firstPickup(product(), new Date("2027-03-01T17:00:00.000Z"), []).weekOf).toBe("2027-03-07");
  });

  it("AC3: on the Tuesday after a cutoff it is the Sunday after next", () => {
    expect(firstPickup(product(), new Date("2027-03-02T17:00:00.000Z"), []).weekOf).toBe("2027-03-14");
  });

  it("AC3: on a pickup Sunday itself, that Sunday's cutoff has passed", () => {
    expect(firstPickup(product(), new Date("2027-03-07T17:00:00.000Z"), []).weekOf).toBe("2027-03-14");
  });

  // Clocks go forward on Sunday 2027-03-14, so midnight on the Monday after it is 04:00Z, not 05:00Z.
  it("AC3: the cutoff is Cleveland's midnight on the Monday after clocks go forward: 23:59 EDT", () => {
    expect(firstPickup(product(), new Date("2027-03-16T03:59:00.000Z"), []).weekOf).toBe("2027-03-21");
  });

  it("AC3: the cutoff is Cleveland's midnight on the Monday after clocks go forward: 00:00 EDT", () => {
    expect(firstPickup(product(), new Date("2027-03-16T04:00:00.000Z"), []).weekOf).toBe("2027-03-28");
  });

  it("AC3: the cutoff is the product's setting, not a Monday in the code", () => {
    const friday = product({ cutoffWeekday: 5, cutoffTime: "18:00:00" });
    expect(firstPickup(friday, new Date("2027-03-05T22:59:00.000Z"), []).weekOf).toBe("2027-03-07");
    expect(firstPickup(friday, new Date("2027-03-05T23:00:00.000Z"), []).weekOf).toBe("2027-03-14");
  });
});

// Issue 133: the weeks an admin changed. Friday 2026-11-06 is long before January 3's cutoff (Monday 2026-12-28,
// 24:00); Tuesday 2026-12-29 is after it and before January 10's.
const BEFORE_JAN_3_CUTOFF = new Date("2026-11-06T15:00:00.000Z");
const AFTER_JAN_3_CUTOFF = new Date("2026-12-29T17:00:00.000Z");

const closed = (weekOf: string): ChangedWeek => ({
  weekOf,
  closedAt: new Date("2026-11-01T12:00:00.000Z"),
  note: "Farm closed",
  firstDay: null,
  lastDay: null,
});
const moved = (weekOf: string, firstDay: string, lastDay: string): ChangedWeek => ({
  weekOf,
  closedAt: null,
  note: "Moved for the holiday",
  firstDay,
  lastDay,
});

describe("AC1 (issue 133) — a closed week is skipped", () => {
  it("AC1: with January 3 closed, the first pickup is the week of January 10, its Sunday and Monday", () => {
    expect(firstPickup(product(), BEFORE_JAN_3_CUTOFF, [closed("2027-01-03")])).toEqual({
      weekOf: "2027-01-10",
      firstDay: "2027-01-10",
      lastDay: "2027-01-11",
    });
  });

  it("AC1: with January 3 and January 10 both closed, both are skipped: January 17", () => {
    expect(firstPickup(product(), BEFORE_JAN_3_CUTOFF, [closed("2027-01-03"), closed("2027-01-10")]).weekOf).toBe("2027-01-17");
  });

  it("AC1: a closed week after the first open one changes nothing: January 3", () => {
    expect(firstPickup(product(), BEFORE_JAN_3_CUTOFF, [closed("2027-01-10")]).weekOf).toBe("2027-01-03");
  });

  it("AC1: a changed week whose closedAt is null is open, and is not skipped", () => {
    const reopened: ChangedWeek = { weekOf: "2027-01-03", closedAt: null, note: "Reopened", firstDay: null, lastDay: null };
    expect(firstPickup(product(), BEFORE_JAN_3_CUTOFF, [reopened])).toEqual({ weekOf: "2027-01-03", firstDay: "2027-01-03", lastDay: "2027-01-04" });
  });
});

describe("AC2 (issue 133) — the cutoff never moves", () => {
  it("AC2: January 3 closed after its cutoff has passed: the first pickup is still January 10, by the cutoff", () => {
    expect(firstPickup(product(), AFTER_JAN_3_CUTOFF, [closed("2027-01-03")]).weekOf).toBe("2027-01-10");
  });

  it("AC2: a moved week's cutoff is its ordinary Sunday's: moving January 10 to Saturday the 9th does not move it", () => {
    const changed = [moved("2027-01-10", "2027-01-09", "2027-01-10")];
    // 23:59 on Monday 2027-01-04, then midnight: January 10's cutoff, as if nothing had moved.
    expect(firstPickup(product(), new Date("2027-01-05T04:59:00.000Z"), changed).weekOf).toBe("2027-01-10");
    expect(firstPickup(product(), new Date("2027-01-05T05:00:00.000Z"), changed).weekOf).toBe("2027-01-17");
  });
});

describe("AC3 (issue 133) — a moved first week", () => {
  it("AC3: January 3 moved to Saturday and Sunday keeps January 3 as its key, and gives the moved days", () => {
    expect(firstPickup(product(), BEFORE_JAN_3_CUTOFF, [moved("2027-01-03", "2027-01-02", "2027-01-03")])).toEqual({
      weekOf: "2027-01-03",
      firstDay: "2027-01-02",
      lastDay: "2027-01-03",
    });
  });
});

describe("AC3, AC5 (issue 133) — pickupWeek", () => {
  it("AC5: an unchanged week is its Sunday and the Monday after", () => {
    expect(pickupWeek("2027-01-03", null)).toEqual({ weekOf: "2027-01-03", firstDay: "2027-01-03", lastDay: "2027-01-04" });
  });

  it("AC5: the Monday after a month's last Sunday is in the next month", () => {
    expect(pickupWeek("2027-01-31", null)).toEqual({ weekOf: "2027-01-31", firstDay: "2027-01-31", lastDay: "2027-02-01" });
  });

  it("AC5: a changed row with no days, reopened, is the Sunday and Monday", () => {
    const reopened: ChangedWeek = { weekOf: "2027-01-03", closedAt: null, note: null, firstDay: null, lastDay: null };
    expect(pickupWeek("2027-01-03", reopened)).toEqual({ weekOf: "2027-01-03", firstDay: "2027-01-03", lastDay: "2027-01-04" });
  });

  it("AC3: a moved week is its first_day and last_day, under its Sunday key", () => {
    expect(pickupWeek("2027-01-03", moved("2027-01-03", "2027-01-02", "2027-01-03"))).toEqual({
      weekOf: "2027-01-03",
      firstDay: "2027-01-02",
      lastDay: "2027-01-03",
    });
  });
});

// The moved lines are new copy, typed once here; the ordinary line is read from the catalog.
describe("AC4, AC5 (issue 133) — pickupWhereLine and firstPickupLine", () => {
  const t = createTranslator("en");

  it("AC4: a week moved to two days names them: Saturday or Sunday", () => {
    expect(pickupWhereLine(t, { weekOf: "2027-01-03", firstDay: "2027-01-02", lastDay: "2027-01-03" }, "en")).toBe(
      "Saturday or Sunday at the farm store, 2304 Bridge Ave. Give your name at the counter.",
    );
  });

  it("AC4: a week moved to one day (first_day = last_day) names one day", () => {
    expect(pickupWhereLine(t, { weekOf: "2027-01-03", firstDay: "2027-01-02", lastDay: "2027-01-02" }, "en")).toBe(
      "Saturday at the farm store, 2304 Bridge Ave. Give your name at the counter.",
    );
  });

  it("AC4: the days named are the week's own: moved to Monday and Tuesday", () => {
    expect(pickupWhereLine(t, { weekOf: "2027-01-03", firstDay: "2027-01-04", lastDay: "2027-01-05" }, "en")).toBe(
      "Monday or Tuesday at the farm store, 2304 Bridge Ave. Give your name at the counter.",
    );
  });

  it("AC5: an ordinary week is today's line, exactly", () => {
    expect(pickupWhereLine(t, { weekOf: "2027-01-03", firstDay: "2027-01-03", lastDay: "2027-01-04" }, "en")).toBe(en["supperClub.box.pickupWhere"]);
  });

  it("AC4: firstPickupLine is the first pickup line with the week's first day", () => {
    expect(firstPickupLine(t, { weekOf: "2027-01-03", firstDay: "2027-01-02", lastDay: "2027-01-03" }, "en")).toBe(t("supperClub.box.firstPickup", { date: formatPickupDate("2027-01-02", "en") }));
  });

  it("AC5: in an ordinary week it is the Sunday, as today", () => {
    expect(firstPickupLine(t, { weekOf: "2027-01-03", firstDay: "2027-01-03", lastDay: "2027-01-04" }, "en")).toBe(t("supperClub.box.firstPickup", { date: formatPickupDate("2027-01-03", "en") }));
  });
});

describe("AC13 — a pickup date in words", () => {
  // Issue 272 made the short month the default, its date held together.
  it('AC13: formatPickupDate gives "Sunday, Jan 3"', () => {
    expect(formatPickupDate("2027-01-03", "en")).toBe("Sunday, Jan 3");
  });

  it("AC13: the day is the stored date's, at either end of a month", () => {
    expect(formatPickupDate("2027-01-31", "en")).toBe("Sunday, Jan 31");
    expect(formatPickupDate("2027-02-28", "en")).toBe("Sunday, Feb 28");
  });

  // Issue 230: Upcoming weeks' charge line sits beside Skip on a phone, so it takes the short month: one line from about 404px wide.
  // A wrap may break after the weekday, never inside the date: the date's own spaces are non-breaking (Eric, 2026-11-22).
  it('issue 230: with the short month it gives "Monday, Jan 11", in Spanish "lunes, 11 de ene", the date held together', () => {
    expect(formatPickupDate("2027-01-11", "en", "short")).toBe("Monday, Jan\u00a011");
    expect(formatPickupDate("2027-01-11", "es", "short")).toBe("lunes, 11\u00a0de\u00a0ene");
  });
});

// Issue 272: a single day in a sentence takes the short month by default, and its month never breaks from its day; the
// space after the weekday's comma still may. The rule's edges are owned here; every site that writes one day reads it
// through its own test.
describe("AC7 (issue 272) \u2014 a single day in a sentence", () => {
  it('AC7: with no month asked for it is the short month, held to its day: "Monday, Nov 30"', () => {
    expect(formatPickupDate("2026-11-30", "en")).toBe("Monday, Nov\u00a030");
  });

  it('AC7: the long month, asked for, is held to its day too: "Monday, November 30"', () => {
    expect(formatPickupDate("2026-11-30", "en", "long")).toBe("Monday, November\u00a030");
  });

  it('AC7: in Spanish the default is the short month too, held: "domingo, 3 de ene"', () => {
    expect(formatPickupDate("2027-01-03", "es")).toBe("domingo, 3\u00a0de\u00a0ene");
  });
});

// Issue 59: when a member joined, on Cleveland's calendar, and how the admin's list writes it.
describe("AC11 (issue 59) — clevelandDate", () => {
  it.each([
    ["the last second of a winter day", "2026-12-02T04:59:59.000Z", "2026-12-01"],
    ["the first second of a winter day", "2026-12-02T05:00:00.000Z", "2026-12-02"],
    ["the last second of a summer day", "2026-07-02T03:59:59.000Z", "2026-07-01"],
    ["the first second of a summer day", "2026-07-02T04:00:00.000Z", "2026-07-02"],
    ["midnight on New Year's Day, UTC, which is still last year", "2027-01-01T00:00:00.000Z", "2026-12-31"],
  ])("AC11 (issue 59): %s is on Cleveland's date", (_what, instant, date) => {
    expect(clevelandDate(new Date(instant))).toBe(date);
  });

  it("AC11 (issue 59): a one-digit month and day are zero-padded", () => {
    expect(clevelandDate(new Date("2027-01-03T17:00:00.000Z"))).toBe("2027-01-03");
  });
});

describe("AC3 (issue 59) — formatShortDate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Issue 272, AC8: the month is held to its day.
  it.each([
    ["2026-12-01", "Dec 1"],
    ["2027-01-31", "Jan 31"],
  ])("AC3 (issue 59): %s reads %j", (date, words) => {
    expect(formatShortDate(date, "en")).toBe(words);
  });

  // It runs in the browser, on the viewer's clock: a date is a date there too.
  it.each(["America/New_York", "America/Los_Angeles", "Pacific/Auckland"])("AC3 (issue 59): it is the same day on a clock in %s", (zone) => {
    vi.stubEnv("TZ", zone);
    expect(formatShortDate("2026-12-01", "en")).toBe("Dec 1");
  });

  it("AC3 (issue 59): it is in the language given", () => {
    expect(formatShortDate("2026-12-01", "es")).toMatch(/dic/i);
  });
});

// Issue 136, AC3b: a member's next pickup, read from any sequence of weeks: `weeksFrom` for a member (`loadNextPickup`),
// the 12 listed for the menu run. Which weeks are listed is upcomingWeeks' (src/pickup-week-calendar.test.ts); here the list is given, so only
// the choice among them is read. Only `weekOf` and `closedAt` decide it; the rest of each week is carried along.
describe("AC3b (issue 136) — nextPickup", () => {
  /** A listed week: an ordinary Sunday and Monday unless moved, open unless closed. */
  const listed = (weekOf: string, over: { closed?: boolean; firstDay?: string; lastDay?: string } = {}): AdminWeek => {
    const days = pickupWeek(weekOf, null);
    const firstDay = over.firstDay ?? days.firstDay;
    const lastDay = over.lastDay ?? days.lastDay;
    const closedAt = over.closed ? new Date("2027-01-25T15:00:00.000Z") : null;
    return {
      weekOf,
      firstDay,
      lastDay,
      cutoff: new Date(`${weekOf}T05:00:00.000Z`),
      closedAt,
      note: null,
      moved: firstDay !== days.firstDay || lastDay !== days.lastDay,
      cutoffPassed: false,
      canReopen: closedAt !== null,
    };
  };

  const FEB_7 = "2027-02-07";
  const FEB_14 = "2027-02-14";
  const FEB_21 = "2027-02-21";

  it("AC3b: for a member whose first week is long past, it is the first listed week", () => {
    expect(nextPickup([listed(FEB_7), listed(FEB_14), listed(FEB_21)], "2027-01-03")).toMatchObject({
      weekOf: FEB_7,
      firstDay: FEB_7,
      lastDay: "2027-02-08",
    });
  });

  it("AC3b: a member who joined after a cutoff sees their first week, not the listed week before it", () => {
    expect(nextPickup([listed(FEB_7), listed(FEB_14), listed(FEB_21)], FEB_14)).toMatchObject({ weekOf: FEB_14 });
  });

  it("AC3b: a closed coming week is passed over to the week after", () => {
    expect(nextPickup([listed(FEB_7, { closed: true }), listed(FEB_14), listed(FEB_21)], "2027-01-03")).toMatchObject({ weekOf: FEB_14 });
  });

  it("AC3b: a closed first week is passed over too: the member's first week closed gives the week after it", () => {
    expect(nextPickup([listed(FEB_7), listed(FEB_14, { closed: true }), listed(FEB_21)], FEB_14)).toMatchObject({ weekOf: FEB_21 });
  });

  it("AC3b: a moved week is given with its moved days, under its Sunday key", () => {
    const moved = listed(FEB_7, { firstDay: "2027-02-06", lastDay: "2027-02-07" });
    expect(nextPickup([moved, listed(FEB_14)], "2027-01-03")).toMatchObject({ weekOf: FEB_7, firstDay: "2027-02-06", lastDay: "2027-02-07" });
  });

  it("AC3b: when every listed week is closed there is none: null", () => {
    expect(nextPickup([listed(FEB_7, { closed: true }), listed(FEB_14, { closed: true })], "2027-01-03")).toBeNull();
  });

  // Issue 196: `lockedOn` is the subscription's declined week. A week up to it was charged and is coming; a week
  // after it is one the member is not getting.
  describe("AC8 (issue 196) — while locked", () => {
    it("AC8: the week found is given when it is before lockedOn", () => {
      expect(nextPickup([listed(FEB_7), listed(FEB_14)], "2027-01-03", FEB_14)).toMatchObject({ weekOf: FEB_7 });
    });

    it("AC8: the week found is given when it is lockedOn itself", () => {
      expect(nextPickup([listed(FEB_7), listed(FEB_14)], "2027-01-03", FEB_7)).toMatchObject({ weekOf: FEB_7 });
    });

    it("AC8: the week found is after lockedOn: null", () => {
      expect(nextPickup([listed(FEB_7), listed(FEB_14)], "2027-01-03", "2027-01-31")).toBeNull();
    });

    it("AC8: lockedOn closed passes over to a week after it: null, not that week", () => {
      expect(nextPickup([listed(FEB_7, { closed: true }), listed(FEB_14)], "2027-01-03", FEB_7)).toBeNull();
    });
  });
});

// Issue 202: a member's next week is walked from `weeksFrom`, the product's weeks one after another without end, so no
// list's length decides it. AC1's edge cases are read here, once; the pages read one skipped week through
// `loadNextPickup`. Wednesday, February 3, 2027, noon in Cleveland: the walk starts at February 7, whose cutoff (the end
// of Monday, February 1) has passed and whose pickup is to come; February 14's cutoff, the end of Monday, February 8, is ahead.
describe("AC1 (issue 202) — the member's next week, walked without end", () => {
  const FEB_3 = new Date("2027-02-03T17:00:00.000Z");
  const FIRST_WEEK = "2027-01-03";
  const FEB_7 = "2027-02-07";
  const FEB_14 = "2027-02-14";
  const FEB_21 = "2027-02-21";
  const sundaysFrom = (first: string, count: number): string[] => Array.from({ length: count }, (_, i) => addDays(first, i * 7));

  /** The first `count` weeks of `weeks`, reading no more of it. */
  const take = (weeks: Iterable<AdminWeek>, count: number): AdminWeek[] => {
    const taken: AdminWeek[] = [];
    for (const week of weeks) {
      taken.push(week);
      if (taken.length === count) break;
    }
    return taken;
  };

  it("AC1: weeksFrom starts where upcomingWeeks does, and its first 12 weeks are upcomingWeeks' 12, a closed and a moved week built alike", () => {
    const changed = [closed(FEB_14), moved(FEB_21, "2027-02-20", FEB_21)];
    expect(take(weeksFrom(product(), FEB_3, changed), 12)).toEqual(upcomingWeeks(product(), FEB_3, changed));
  });

  it("AC1: weeksFrom goes on past the 12th, each week built as upcomingWeeks builds it: the 13th to the 24th, and the 60th, closed", () => {
    const sundays = sundaysFrom(FEB_7, 60);
    const sixtieth = sundays[59] ?? "";
    const changed = [closed(sundays[12] ?? ""), closed(sixtieth)];
    const walked = take(weeksFrom(product(), FEB_3, changed), 60);
    expect(walked.map((week) => week.weekOf)).toEqual(sundays);
    expect(walked.slice(12, 24)).toEqual(upcomingWeeks(product(), FEB_3, changed, sundays[12]));
    expect(walked[59]).toEqual(upcomingWeeks(product(), FEB_3, changed, sixtieth)[0]);
    expect(walked[59]?.closedAt).not.toBeNull();
  });

  it("AC1: with all 12 weeks a list would show closed, the next week is the 13th, May 2", () => {
    const changed = sundaysFrom(FEB_7, 12).map(closed);
    expect(nextPickup(weeksFrom(product(), FEB_3, changed), FIRST_WEEK)).toMatchObject({ weekOf: "2027-05-02" });
  });

  it("AC1: the current week is next though its cutoff has passed: its pickup is still to come", () => {
    expect(nextPickup(weeksFrom(product(), FEB_3, []), FIRST_WEEK)).toMatchObject({ weekOf: FEB_7 });
  });

  it("AC1: a skipped week is passed over to the week after", () => {
    expect(nextPickup(weeksFrom(product(), FEB_3, []), FIRST_WEEK, null, { skipped: [FEB_7] })).toMatchObject({ weekOf: FEB_14 });
  });

  it("AC1: skipped and closed weeks together are passed over: February 7 skipped and February 14 closed give February 21", () => {
    expect(nextPickup(weeksFrom(product(), FEB_3, [closed(FEB_14)]), FIRST_WEEK, null, { skipped: [FEB_7] })).toMatchObject({ weekOf: FEB_21 });
  });

  it("AC1: a declined week is not locked: the first week not closed or skipped, it is next", () => {
    expect(nextPickup(weeksFrom(product(), FEB_3, []), FIRST_WEEK, FEB_14, { skipped: [FEB_7] })).toMatchObject({ weekOf: FEB_14 });
  });

  it("AC3 (issue 202): with cutoffAhead, a week whose cutoff has passed is passed over: February 14, the first whose cutoff is ahead", () => {
    expect(nextPickup(weeksFrom(product(), FEB_3, []), FIRST_WEEK, null, { cutoffAhead: true })).toMatchObject({ weekOf: FEB_14 });
  });

  it("AC1: over an endless walk it stops at the first week after lockedOn: null, and no week past that one is read", () => {
    let read = 0;
    // Every week closed, so only the stop after lockedOn ends the walk; a walk that does not stop is cut off ten years on.
    function* endless(): Generator<AdminWeek> {
      for (const weekOf of sundaysFrom(FEB_7, 520)) {
        read++;
        yield {
          ...pickupWeek(weekOf, null),
          cutoff: new Date(`${weekOf}T05:00:00.000Z`),
          closedAt: new Date("2027-01-25T15:00:00.000Z"),
          note: null,
          moved: false,
          cutoffPassed: false,
          canReopen: true,
        };
      }
    }
    expect(nextPickup(endless(), FIRST_WEEK, FEB_21)).toBeNull();
    // February 7, 14 and 21, then February 28, the first week after lockedOn.
    expect(read).toBe(4);
  });
});

// Issue 155: the weeks a member's account pages list. The cut between them is the week's last pickup day, in
// Cleveland: a week is on Upcoming weeks (upcomingWeeks) through that day and on History (pastWeeks) from the day
// after. Which weeks upcomingWeeks lists with no first week is src/pickup-week-calendar.test.ts's; here are the first
// week it is given and the past weeks. Wednesday, February 3, 2027, noon in Cleveland: January 31's pickup ended
// Monday, February 1; February 7's is to come.
describe("AC2, AC6 (issue 155) — a member's weeks", () => {
  const FEB_3 = new Date("2027-02-03T17:00:00.000Z");
  const sundaysFrom = (first: string, count: number, step = 7): string[] =>
    Array.from({ length: count }, (_, i) => new Date(Date.parse(`${first}T00:00:00Z`) + i * step * 86_400_000).toISOString().slice(0, 10));
  const weeksOf = (weeks: AdminWeek[]): string[] => weeks.map((week) => week.weekOf);

  describe("AC2 — upcomingWeeks from a member's first week", () => {
    it("AC2: a member whose first week is later than the current week still sees 12 weeks, starting at their first week", () => {
      expect(weeksOf(upcomingWeeks(product(), FEB_3, [], "2027-02-21"))).toEqual(sundaysFrom("2027-02-21", 12));
    });

    it("AC2: a member whose first week has passed sees the 12 weeks from the current week, as with no first week", () => {
      expect(weeksOf(upcomingWeeks(product(), FEB_3, [], "2027-01-03"))).toEqual(sundaysFrom("2027-02-07", 12));
    });
  });

  describe("AC2 — listedWeekTitle", () => {
    const t = createTranslator("en");
    const MOVED: ChangedWeek = { weekOf: "2027-02-14", closedAt: null, note: null, firstDay: "2027-02-13", lastDay: "2027-02-14" };
    const listedWeek = (changed: ChangedWeek): AdminWeek => {
      const found = upcomingWeeks(product(), FEB_3, [changed]).find((week) => week.weekOf === changed.weekOf);
      if (!found) throw new Error(`${changed.weekOf} is not listed at ${FEB_3.toISOString()}`);
      return found;
    };

    it("AC2: an open week's title is its days, moved days and all", () => {
      expect(listedWeekTitle(t, listedWeek(MOVED), "en")).toBe(weekTitle(t, pickupWeek("2027-02-14", MOVED), "en"));
    });

    it("AC2: a closed week that was moved is titled by its ordinary days, its move waiting for a reopen: February 14 and 15", () => {
      const closedMoved = { ...MOVED, closedAt: new Date("2027-02-01T15:00:00.000Z") };
      expect(listedWeekTitle(t, listedWeek(closedMoved), "en")).toBe(weekTitle(t, pickupWeek("2027-02-14", null), "en"));
    });
  });

  describe("AC6 — pastWeeks", () => {
    it("AC6: every week from the member's first week whose last pickup day has passed, newest first", () => {
      expect(weeksOf(pastWeeks(product(), FEB_3, [], "2027-01-03"))).toEqual(sundaysFrom("2027-01-31", 5, -7));
    });

    it("AC6: a member whose first week is later has no week before it", () => {
      expect(weeksOf(pastWeeks(product(), FEB_3, [], "2027-01-17"))).toEqual(["2027-01-31", "2027-01-24", "2027-01-17"]);
    });

    it("AC6: a member whose first week has not passed has none", () => {
      expect(pastWeeks(product(), FEB_3, [], "2027-02-07")).toEqual([]);
    });

    it("AC6: never a week before the product's first pickup date", () => {
      expect(weeksOf(pastWeeks(product(), FEB_3, [], "2026-12-20")).at(-1)).toBe("2027-01-03");
    });

    // Monday, February 1 is January 31's last pickup day; midnight ending it, EST, is 05:00Z on the 2nd.
    it.each([
      ["at 23:59 on its last pickup day it is still upcoming, not past", "2027-02-02T04:59:00.000Z", "2027-01-24", "2027-01-31"],
      ["a minute later it is past, and no longer upcoming", "2027-02-02T05:00:00.000Z", "2027-01-31", "2027-02-07"],
    ])("AC6: the cut is the week's last pickup day: %s", (_what, instant, newestPast, firstUpcoming) => {
      const now = new Date(instant);
      const past = weeksOf(pastWeeks(product(), now, [], "2027-01-03"));
      const upcoming = weeksOf(upcomingWeeks(product(), now, [], "2027-01-03"));
      expect(past[0]).toBe(newestPast);
      expect(upcoming[0]).toBe(firstUpcoming);
      expect(past.filter((weekOf) => upcoming.includes(weekOf))).toEqual([]);
    });

    it("AC6: a week moved to Saturday and Sunday is past on the Monday after: its moved last day is the cut", () => {
      const moved: ChangedWeek = { weekOf: "2027-01-31", closedAt: null, note: null, firstDay: "2027-01-30", lastDay: "2027-01-31" };
      const monday = new Date("2027-02-01T17:00:00.000Z");
      expect(pastWeeks(product(), monday, [moved], "2027-01-03")[0]).toMatchObject({ weekOf: "2027-01-31", firstDay: "2027-01-30", lastDay: "2027-01-31", moved: true });
      expect(weeksOf(upcomingWeeks(product(), monday, [moved], "2027-01-03"))[0]).toBe("2027-02-07");
    });

    it("AC6: each week is built as upcomingWeeks builds one: a closed week carries its closing and note, its cutoff passed", () => {
      const closedAt = new Date("2027-01-12T15:00:00.000Z");
      const changed: ChangedWeek[] = [{ weekOf: "2027-01-17", closedAt, note: "Kitchen flooded", firstDay: null, lastDay: null }];
      expect(pastWeeks(product(), FEB_3, changed, "2027-01-03").find((week) => week.weekOf === "2027-01-17")).toEqual({
        weekOf: "2027-01-17",
        firstDay: "2027-01-17",
        lastDay: "2027-01-18",
        cutoff: new Date("2027-01-12T05:00:00.000Z"),
        closedAt,
        note: "Kitchen flooded",
        moved: false,
        cutoffPassed: true,
        canReopen: false,
      });
    });
  });
});

// Issue 134: the one week a charge run enrols, the latest whose cutoff has passed (DEC-034). January 3's cutoff is
// the end of Monday 2026-12-28 in Cleveland, 2026-12-29T05:00Z; January 10's is 2027-01-05T05:00Z. The rule's edges
// are owned here; src/charge-run.test.ts takes the run through it.
describe("AC3 (issue 134) — latestCutoffWeek", () => {
  it("AC3: before the first Sunday's cutoff there is none: null", () => {
    expect(latestCutoffWeek(product(), new Date("2026-12-29T04:59:59.999Z"))).toBeNull();
  });

  it("AC3: at the first Sunday's cutoff instant it is that Sunday", () => {
    expect(latestCutoffWeek(product(), new Date("2026-12-29T05:00:00.000Z"))).toBe("2027-01-03");
  });

  it("AC3: a moment before the next cutoff it is still the earlier week, not the one whose cutoff has not passed", () => {
    expect(latestCutoffWeek(product(), new Date("2027-01-05T04:59:59.999Z"))).toBe("2027-01-03");
  });

  it("AC3: at the next cutoff it is the next week, not the earlier one", () => {
    expect(latestCutoffWeek(product(), new Date("2027-01-05T05:00:00.000Z"))).toBe("2027-01-10");
  });

  it("AC3: long after the first pickup it is the latest week whose cutoff has passed, not an earlier one", () => {
    // Tuesday 2027-03-02: March 7's cutoff passed at the end of Monday the 1st; March 14's has not.
    expect(latestCutoffWeek(product(), new Date("2027-03-02T17:00:00.000Z"))).toBe("2027-03-07");
  });

  // Clocks go forward on Sunday 2027-03-14, so March 21's cutoff, the end of Monday the 15th, is 04:00Z.
  it("AC3: the cutoff is Cleveland's midnight after clocks go forward: 23:59 EDT is still March 14's week, 00:00 is March 21's", () => {
    expect(latestCutoffWeek(product(), new Date("2027-03-16T03:59:00.000Z"))).toBe("2027-03-14");
    expect(latestCutoffWeek(product(), new Date("2027-03-16T04:00:00.000Z"))).toBe("2027-03-21");
  });

  it("AC3: never a week before the product's first Sunday: a first pickup date of Tuesday January 5 has none until January 10's cutoff", () => {
    const tuesday = product({ firstPickupDate: "2027-01-05" });
    expect(latestCutoffWeek(tuesday, new Date("2027-01-04T17:00:00.000Z"))).toBeNull();
    expect(latestCutoffWeek(tuesday, new Date("2027-01-05T05:00:00.000Z"))).toBe("2027-01-10");
  });

  it("AC3: the cutoff is the product's setting: Friday 18:00 before March 7", () => {
    const friday = product({ cutoffWeekday: 5, cutoffTime: "18:00:00" });
    expect(latestCutoffWeek(friday, new Date("2027-03-05T22:59:00.000Z"))).toBe("2027-02-28");
    expect(latestCutoffWeek(friday, new Date("2027-03-05T23:00:00.000Z"))).toBe("2027-03-07");
  });
});

// Issue 272, replacing issue 142's AC3: the weeks the weekly lists offer, in calendar order. The range and the closed
// weeks are owned here; the screen, the two downloads and the print page each take one offered and one fallen-back
// week through it (app/admin/lists/). Wednesday, February 3, 2027, noon in Cleveland: the calendar starts at February 7,
// and January 31's pickup is over.
describe("AC1, AC2 (issue 272) — listableWeeks", () => {
  const FEB_3 = new Date("2027-02-03T17:00:00.000Z");
  const sundaysFrom = (first: string, count: number, step = 7): string[] =>
    Array.from({ length: count }, (_, i) => new Date(Date.parse(`${first}T00:00:00Z`) + i * step * 86_400_000).toISOString().slice(0, 10));
  const weeksOf = (weeks: AdminWeek[]): string[] => weeks.map((week) => week.weekOf);
  const closed = (weekOf: string): ChangedWeek => ({ weekOf, closedAt: new Date("2027-01-05T15:00:00.000Z"), note: null, firstDay: null, lastDay: null });

  it("AC1: 12 weeks in calendar order, from 2 weeks before the current week to 9 after it: January 24 to April 11", () => {
    expect(weeksOf(listableWeeks(product(), FEB_3, []))).toEqual(["2027-01-24", "2027-01-31", ...sundaysFrom("2027-02-07", 10)]);
  });

  it("AC1: each week is the one the calendar builds, a moved week's days and cutoffPassed included", () => {
    const changed: ChangedWeek[] = [{ weekOf: "2027-02-21", closedAt: null, note: "Heads up", firstDay: "2027-02-20", lastDay: "2027-02-21" }];
    expect(listableWeeks(product(), FEB_3, changed)).toEqual([
      ...pastWeeks(product(), FEB_3, changed, "2027-01-03").slice(0, 2).reverse(),
      ...upcomingWeeks(product(), FEB_3, changed).slice(0, 10),
    ]);
  });

  it("AC2: a closed week is left out, past or ahead, the others in the same order, with no week added in its place", () => {
    const ahead = sundaysFrom("2027-02-07", 10).filter((weekOf) => weekOf !== "2027-02-14");
    expect(weeksOf(listableWeeks(product(), FEB_3, [closed("2027-02-14"), closed("2027-01-24")]))).toEqual(["2027-01-31", ...ahead]);
  });

  it("AC1: never a week before the product's first pickup date: with one past week, the list holds 11", () => {
    // Wednesday, January 6: January 3's pickup is over, January 10 is the current week.
    expect(weeksOf(listableWeeks(product(), new Date("2027-01-06T17:00:00.000Z"), []))).toEqual(["2027-01-03", ...sundaysFrom("2027-01-10", 10)]);
  });
});

// Issue 272: the week the weekly lists open on, owned here; loadWeekLists and the week-lists seed take it through this.
// The current week is the one upcomingWeeks starts from: the earliest whose last pickup day has not passed in Cleveland.
describe("AC3 (issue 272) — defaultListedWeek", () => {
  const FEB_3 = new Date("2027-02-03T17:00:00.000Z");
  // Monday, February 1, noon in Cleveland: January 31's last pickup day.
  const FEB_1 = new Date("2027-02-01T17:00:00.000Z");
  const closedWeek = (weekOf: string): ChangedWeek => ({ weekOf, closedAt: new Date("2027-01-05T15:00:00.000Z"), note: null, firstDay: null, lastDay: null });
  const opensOn = (now: Date, changed: ChangedWeek[]): AdminWeek | undefined => defaultListedWeek(product(), now, changed, listableWeeks(product(), now, changed));

  it("AC3: it is the current week, not the first week listed: February 7", () => {
    const weeks = listableWeeks(product(), FEB_3, []);
    expect(defaultListedWeek(product(), FEB_3, [], weeks)).toEqual(weeks.find((week) => week.weekOf === "2027-02-07"));
  });

  it("AC3: on a week's last pickup day it is still that week: on Monday, February 1, January 31", () => {
    expect(opensOn(FEB_1, [])?.weekOf).toBe("2027-01-31");
  });

  it("AC3: a week moved to Saturday and Sunday is over by its Monday: on Monday, February 1, January 31 so moved gives February 7", () => {
    expect(opensOn(FEB_1, [moved("2027-01-31", "2027-01-30", "2027-01-31")])?.weekOf).toBe("2027-02-07");
  });

  it("AC3: when the current week is closed it is the first open week after it: February 14", () => {
    expect(opensOn(FEB_3, [closedWeek("2027-02-07")])?.weekOf).toBe("2027-02-14");
  });

  it("AC3: when every week from the current one on is closed, it is the first week listed: January 24", () => {
    const ahead = Array.from({ length: 10 }, (_, i) => closedWeek(addDays("2027-02-07", i * 7)));
    expect(opensOn(FEB_3, ahead)?.weekOf).toBe("2027-01-24");
  });
});

// Issue 141: the day a week's menu email goes out, the first date after the week's cutoff date whose weekday is
// MENU_EMAIL_WEEKDAY (Sunday 0). January 17's cutoff date is Monday the 11th. The rule's edges are owned here;
// src/menu-run.test.ts takes the run through it.
describe("AC2 (issue 141) — menuEmailDate", () => {
  it.each([
    [2, "2027-01-12", "Tuesday, the day after the cutoff date"],
    [4, "2027-01-14", "Thursday"],
    [6, "2027-01-16", "Saturday"],
    [0, "2027-01-17", "Sunday, the week's own Sunday"],
  ])("AC2: weekday %i gives %s (%s)", (weekday, date) => {
    expect(menuEmailDate(product(), "2027-01-17", weekday)).toBe(date);
  });

  it("AC2: the cutoff date's own weekday is the week after it, never the cutoff date itself", () => {
    expect(menuEmailDate(product(), "2027-01-17", 1)).toBe("2027-01-18");
  });

  it("AC2: it follows the product's cutoff day: a Friday cutoff for March 7 is Friday March 5, so Saturday is March 6 and Friday March 12", () => {
    const friday = product({ cutoffWeekday: 5, cutoffTime: "18:00:00" });
    expect(menuEmailDate(friday, "2027-03-07", 6)).toBe("2027-03-06");
    expect(menuEmailDate(friday, "2027-03-07", 5)).toBe("2027-03-12");
  });

  it("AC2: across a month's end: January 31's cutoff date is Monday January 25, so Wednesday is January 27 and Monday February 1", () => {
    expect(menuEmailDate(product(), "2027-01-31", 3)).toBe("2027-01-27");
    expect(menuEmailDate(product(), "2027-01-31", 1)).toBe("2027-02-01");
  });
});
