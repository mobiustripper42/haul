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
  pickupWeek,
  pickupWhereLine,
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
