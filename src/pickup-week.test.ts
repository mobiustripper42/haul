// Issue 56, AC3 and AC13: the first pickup a signup pays for, read from the product's settings in Cleveland
// time, and a pickup date in words.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "./i18n.js";
import { en } from "./messages/en.js";
import {
  clevelandDate,
  firstPickup,
  firstPickupLine,
  formatPickupDate,
  formatShortDate,
  latestCutoffWeek,
  listedWeekTitle,
  nextPickup,
  pastWeeks,
  pickupWeek,
  pickupWhereLine,
  upcomingWeeks,
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
    expect(firstPickupLine(t, { weekOf: "2027-01-03", firstDay: "2027-01-02", lastDay: "2027-01-03" }, "en")).toBe(
      t("supperClub.box.firstPickup", { date: "Saturday, January 2" }),
    );
  });

  it("AC5: in an ordinary week it is the Sunday, as today", () => {
    expect(firstPickupLine(t, { weekOf: "2027-01-03", firstDay: "2027-01-03", lastDay: "2027-01-04" }, "en")).toBe(
      t("supperClub.box.firstPickup", { date: "Sunday, January 3" }),
    );
  });
});

describe("AC13 — a pickup date in words", () => {
  it('AC13: formatPickupDate gives "Sunday, January 3"', () => {
    expect(formatPickupDate("2027-01-03", "en")).toBe("Sunday, January 3");
  });

  it("AC13: the day is the stored date's, at either end of a month", () => {
    expect(formatPickupDate("2027-01-31", "en")).toBe("Sunday, January 31");
    expect(formatPickupDate("2027-02-28", "en")).toBe("Sunday, February 28");
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

  it.each([
    ["2026-12-01", "Dec 1"],
    ["2027-01-31", "Jan 31"],
  ])("AC3 (issue 59): %s reads %j", (date, words) => {
    expect(formatShortDate(date, "en")).toBe(words);
  });

  // It runs in the browser, on the viewer's clock: a date is a date there too.
  it.each(["America/New_York", "America/Los_Angeles", "Pacific/Auckland"])("AC3 (issue 59): it is the same day on a clock in %s", (zone) => {
    vi.stubEnv("TZ", zone);
    expect(formatShortDate("2026-12-01", "en")).toBe("Dec 1");
  });

  it("AC3 (issue 59): it is in the language given", () => {
    expect(formatShortDate("2026-12-01", "es")).toMatch(/dic/i);
  });
});

// Issue 136, AC3b: a member's next pickup, read from the weeks the calendar lists (`loadCalendar(repo, now).weeks`).
// Which weeks are listed is upcomingWeeks' (src/pickup-week-calendar.test.ts); here the list is given, so only
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
