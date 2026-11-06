// Issue 56, AC3 and AC13: the first pickup a signup pays for, read from the product's settings in Cleveland
// time, and a pickup date in words.
import { afterEach, describe, expect, it, vi } from "vitest";
import { clevelandDate, firstPickup, formatPickupDate, formatShortDate } from "./pickup-week.js";
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
    expect(firstPickup(product(), new Date("2026-12-29T04:59:00.000Z"))).toBe("2027-01-03");
  });

  it("AC3: a minute later it is January 10", () => {
    expect(firstPickup(product(), new Date("2026-12-29T05:00:00.000Z"))).toBe("2027-01-10");
  });

  it("AC3: long before the first pickup date it is the first pickup date", () => {
    expect(firstPickup(product(), new Date("2026-11-06T15:00:00.000Z"))).toBe("2027-01-03");
  });

  it("AC3: a first pickup date that is not a Sunday gives the first Sunday after it", () => {
    expect(firstPickup(product({ firstPickupDate: "2027-01-05" }), new Date("2026-11-06T15:00:00.000Z"))).toBe("2027-01-10");
  });

  it("AC3: well after the first pickup date, the Monday before a Sunday still catches that Sunday", () => {
    expect(firstPickup(product(), new Date("2027-03-01T17:00:00.000Z"))).toBe("2027-03-07");
  });

  it("AC3: on the Tuesday after a cutoff it is the Sunday after next", () => {
    expect(firstPickup(product(), new Date("2027-03-02T17:00:00.000Z"))).toBe("2027-03-14");
  });

  it("AC3: on a pickup Sunday itself, that Sunday's cutoff has passed", () => {
    expect(firstPickup(product(), new Date("2027-03-07T17:00:00.000Z"))).toBe("2027-03-14");
  });

  // Clocks go forward on Sunday 2027-03-14, so midnight on the Monday after it is 04:00Z, not 05:00Z.
  it("AC3: the cutoff is Cleveland's midnight on the Monday after clocks go forward: 23:59 EDT", () => {
    expect(firstPickup(product(), new Date("2027-03-16T03:59:00.000Z"))).toBe("2027-03-21");
  });

  it("AC3: the cutoff is Cleveland's midnight on the Monday after clocks go forward: 00:00 EDT", () => {
    expect(firstPickup(product(), new Date("2027-03-16T04:00:00.000Z"))).toBe("2027-03-28");
  });

  it("AC3: the cutoff is the product's setting, not a Monday in the code", () => {
    const friday = product({ cutoffWeekday: 5, cutoffTime: "18:00:00" });
    expect(firstPickup(friday, new Date("2027-03-05T22:59:00.000Z"))).toBe("2027-03-07");
    expect(firstPickup(friday, new Date("2027-03-05T23:00:00.000Z"))).toBe("2027-03-14");
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
