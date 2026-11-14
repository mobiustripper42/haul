// Issue 149: the admin's calendar in the core — each week's cutoff, the 12 weeks the screen lists, the move
// check, and the week's days as a title. The cutoff's clock edges through `firstPickup` stay in
// src/pickup-week.test.ts; these hold the functions the screen, the actions and signup share.
import { describe, expect, it } from "vitest";
import { createTranslator } from "./i18n.js";
import { checkMove, cutoffDate, cutoffInstant, isMoved, pickupWeek, upcomingWeeks, weekTitle, type ChangedWeek } from "./pickup-week.js";
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

const FRIDAY_EVENING = { cutoffWeekday: 5, cutoffTime: "18:00:00" };

const week = (weekOf: string, over: Partial<ChangedWeek> = {}): ChangedWeek => ({
  weekOf,
  closedAt: null,
  note: null,
  firstDay: null,
  lastDay: null,
  ...over,
});

describe("AC9 — cutoffDate", () => {
  it("AC9: the week of January 24's cutoff is dated Monday, January 18", () => {
    expect(cutoffDate(product(), "2027-01-24")).toBe("2027-01-18");
  });

  it("AC9: a 24:00 cutoff is dated the Monday, not the Tuesday its instant falls on", () => {
    expect(cutoffDate(product({ cutoffTime: "24:00:00" }), "2027-03-21")).toBe("2027-03-15");
  });

  it("AC9: it is the product's cutoff weekday, not a Monday in the code: Friday, January 22", () => {
    expect(cutoffDate(product(FRIDAY_EVENING), "2027-01-24")).toBe("2027-01-22");
  });
});

describe("AC1 — cutoffInstant", () => {
  it("AC1: the week of January 24 is cut off at Cleveland's midnight ending Monday, January 18", () => {
    expect(cutoffInstant(product(), "2027-01-24")).toEqual(new Date("2027-01-19T05:00:00.000Z"));
  });

  // Clocks go forward on Sunday 2027-03-14, so midnight ending the Monday after is 04:00Z.
  it("AC1: after clocks go forward it is midnight in EDT", () => {
    expect(cutoffInstant(product(), "2027-03-21")).toEqual(new Date("2027-03-16T04:00:00.000Z"));
  });

  it("AC1: it is the product's cutoff weekday and time: 18:00 on Friday, March 5", () => {
    expect(cutoffInstant(product(FRIDAY_EVENING), "2027-03-07")).toEqual(new Date("2027-03-05T23:00:00.000Z"));
  });
});

describe("AC10 — isMoved", () => {
  it("AC10: an ordinary week, its Sunday and the Monday after, is not moved", () => {
    expect(isMoved(pickupWeek("2027-02-07", null))).toBe(false);
  });

  it("AC10: a week on Saturday and Sunday is moved", () => {
    expect(isMoved({ weekOf: "2027-02-07", firstDay: "2027-02-06", lastDay: "2027-02-07" })).toBe(true);
  });

  it("AC10: a week on its Sunday only is moved", () => {
    expect(isMoved({ weekOf: "2027-02-07", firstDay: "2027-02-07", lastDay: "2027-02-07" })).toBe(true);
  });

  it("AC10: a week whose days are put back to its Sunday and Monday is not moved", () => {
    expect(isMoved(pickupWeek("2027-02-07", week("2027-02-07", { firstDay: "2027-02-07", lastDay: "2027-02-08" })))).toBe(false);
  });
});

// New copy, typed once here (src/messages/en.ts gains it with this task).
describe("AC14 — weekTitle", () => {
  const t = createTranslator("en");

  it('AC14: an ordinary week is its two dates: "January 17 and 18"', () => {
    expect(weekTitle(t, pickupWeek("2027-01-17", null), "en")).toBe("January 17 and 18");
  });

  it('AC14: a moved week names its days: "Saturday, February 6 and Sunday, February 7"', () => {
    expect(weekTitle(t, { weekOf: "2027-02-07", firstDay: "2027-02-06", lastDay: "2027-02-07" }, "en")).toBe(
      "Saturday, February 6 and Sunday, February 7",
    );
  });

  it('AC14: a one-day week is that day only: "Sunday, February 7 only"', () => {
    expect(weekTitle(t, { weekOf: "2027-02-07", firstDay: "2027-02-07", lastDay: "2027-02-07" }, "en")).toBe("Sunday, February 7 only");
  });
});

// Wednesday, January 20, noon in Cleveland: January 17's pickup ended Monday the 18th; January 24's cutoff, the
// end of Monday the 18th, has passed, and its pickup has not come.
const JAN_20 = new Date("2027-01-20T17:00:00.000Z");

const sundaysFrom = (first: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => new Date(Date.parse(`${first}T00:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10));

describe("AC1 — upcomingWeeks lists 12 weeks", () => {
  it("AC1: 12 weeks in date order, from the earliest whose last pickup day has not passed", () => {
    expect(upcomingWeeks(product(), JAN_20, []).map((w) => w.weekOf)).toEqual(sundaysFrom("2027-01-24", 12));
  });

  it("AC1: a week past its cutoff but before its pickup is listed, and says its cutoff has passed", () => {
    const [first, second] = upcomingWeeks(product(), JAN_20, []);
    expect(first).toMatchObject({ weekOf: "2027-01-24", cutoffPassed: true });
    expect(second).toMatchObject({ weekOf: "2027-01-31", cutoffPassed: false });
  });

  it("AC1: a week is listed through the whole of its last day in Cleveland, and gone a minute after", () => {
    expect(upcomingWeeks(product(), new Date("2027-01-26T04:59:00.000Z"), [])[0]?.weekOf).toBe("2027-01-24");
    expect(upcomingWeeks(product(), new Date("2027-01-26T05:00:00.000Z"), [])[0]?.weekOf).toBe("2027-01-31");
  });

  it("AC1: a moved week is listed through its moved last day: moved to Saturday and Sunday, it is gone on the Monday", () => {
    const monday = new Date("2027-01-25T17:00:00.000Z");
    expect(upcomingWeeks(product(), monday, [])[0]?.weekOf).toBe("2027-01-24");
    expect(upcomingWeeks(product(), monday, [week("2027-01-24", { firstDay: "2027-01-23", lastDay: "2027-01-24" })])[0]?.weekOf).toBe("2027-01-31");
  });

  it("AC1: it never shows a week before the product's first pickup date", () => {
    expect(upcomingWeeks(product(), new Date("2026-11-10T17:00:00.000Z"), []).map((w) => w.weekOf)).toEqual(sundaysFrom("2027-01-03", 12));
  });

  it("AC1: a first pickup date that is not a Sunday starts the list at the Sunday after it", () => {
    expect(upcomingWeeks(product({ firstPickupDate: "2027-01-05" }), new Date("2026-11-10T17:00:00.000Z"), [])[0]?.weekOf).toBe("2027-01-10");
  });

  it("AC1: each week has its pickup days and its cutoff, and an unchanged week is open, unmoved and has no note", () => {
    expect(upcomingWeeks(product(), JAN_20, [])[1]).toMatchObject({
      weekOf: "2027-01-31",
      firstDay: "2027-01-31",
      lastDay: "2027-02-01",
      cutoff: new Date("2027-01-26T05:00:00.000Z"),
      closedAt: null,
      note: null,
      moved: false,
      cutoffPassed: false,
    });
  });
});

describe("AC2, AC6–AC9 — what upcomingWeeks says of a changed week", () => {
  const CLOSED_AT = new Date("2027-01-15T15:00:00.000Z");
  const of = (weeks: ReturnType<typeof upcomingWeeks>, weekOf: string) => weeks.find((w) => w.weekOf === weekOf);

  it("AC2, AC7: a week closed before its cutoff carries its closing and note, and can be reopened", () => {
    const weeks = upcomingWeeks(product(), JAN_20, [week("2027-01-31", { closedAt: CLOSED_AT, note: "Kitchen flooded" })]);
    expect(of(weeks, "2027-01-31")).toMatchObject({ closedAt: CLOSED_AT, note: "Kitchen flooded", cutoffPassed: false, canReopen: true });
  });

  it("AC8: a closed week past its cutoff cannot be reopened", () => {
    const weeks = upcomingWeeks(product(), JAN_20, [week("2027-01-24", { closedAt: CLOSED_AT })]);
    expect(of(weeks, "2027-01-24")).toMatchObject({ closedAt: CLOSED_AT, cutoffPassed: true, canReopen: false });
  });

  it("AC8: the cutoff has passed at its very instant, and not a millisecond before", () => {
    const changed = [week("2027-01-31", { closedAt: CLOSED_AT })];
    const cutoff = new Date("2027-01-26T05:00:00.000Z");
    expect(of(upcomingWeeks(product(), new Date(cutoff.getTime() - 1), changed), "2027-01-31")).toMatchObject({ cutoffPassed: false, canReopen: true });
    expect(of(upcomingWeeks(product(), cutoff, changed), "2027-01-31")).toMatchObject({ cutoffPassed: true, canReopen: false });
  });

  it("AC9: a moved week has its moved days and its ordinary Sunday's cutoff", () => {
    const weeks = upcomingWeeks(product(), JAN_20, [week("2027-01-31", { firstDay: "2027-01-30", lastDay: "2027-01-31" })]);
    expect(of(weeks, "2027-01-31")).toMatchObject({
      firstDay: "2027-01-30",
      lastDay: "2027-01-31",
      moved: true,
      cutoff: new Date("2027-01-26T05:00:00.000Z"),
    });
  });

  it("AC7: a closed week that was moved keeps its move: moved, with its moved days", () => {
    const weeks = upcomingWeeks(product(), JAN_20, [week("2027-01-31", { closedAt: CLOSED_AT, firstDay: "2027-01-30", lastDay: "2027-01-31" })]);
    expect(of(weeks, "2027-01-31")).toMatchObject({ closedAt: CLOSED_AT, moved: true, firstDay: "2027-01-30", lastDay: "2027-01-31" });
  });

  it("AC6: an open week carrying a note (DEC-030) is open, unmoved, with its note", () => {
    const weeks = upcomingWeeks(product(), JAN_20, [week("2027-01-31", { note: "Heads up" })]);
    expect(of(weeks, "2027-01-31")).toMatchObject({ closedAt: null, note: "Heads up", moved: false, firstDay: "2027-01-31", lastDay: "2027-02-01" });
  });
});

// The week of January 24: its cutoff is dated Monday, January 18; the next week's, Monday, January 25.
describe("AC9 — checkMove", () => {
  it.each([
    ["Saturday and Sunday", "2027-01-23", "2027-01-24"],
    ["one day, the day after the cutoff date", "2027-01-19", "2027-01-19"],
    ["a last day on the next week's cutoff date", "2027-01-24", "2027-01-25"],
  ])('AC9: %s is "ok"', (_what, firstDay, lastDay) => {
    expect(checkMove(product(), "2027-01-24", firstDay, lastDay)).toBe("ok");
  });

  it.each([
    ["on the cutoff date", "2027-01-18", "2027-01-24"],
    ["before the cutoff date", "2027-01-17", "2027-01-24"],
  ])('AC9: a first day %s is "beforeCutoff"', (_what, firstDay, lastDay) => {
    expect(checkMove(product(), "2027-01-24", firstDay, lastDay)).toBe("beforeCutoff");
  });

  it('AC9: a last day before the first is "order"', () => {
    expect(checkMove(product(), "2027-01-24", "2027-01-24", "2027-01-23")).toBe("order");
  });

  it('AC9: a last day after the next week\'s cutoff date is "overlapsNext"', () => {
    expect(checkMove(product(), "2027-01-24", "2027-01-24", "2027-01-26")).toBe("overlapsNext");
  });

  it.each([
    ["beforeCutoff before order", "2027-01-18", "2027-01-17", "beforeCutoff"],
    ["beforeCutoff before overlapsNext", "2027-01-18", "2027-01-26", "beforeCutoff"],
    ["order before overlapsNext", "2027-01-27", "2027-01-26", "order"],
  ])("AC9: with two faults it reports one, %s", (_what, firstDay, lastDay, fault) => {
    expect(checkMove(product(), "2027-01-24", firstDay, lastDay)).toBe(fault);
  });

  it("AC9: both bounds are the product's cutoff weekday: a Friday cutoff dates them Friday, January 22 and Friday, January 29", () => {
    const friday = product(FRIDAY_EVENING);
    expect(checkMove(friday, "2027-01-24", "2027-01-22", "2027-01-23")).toBe("beforeCutoff");
    expect(checkMove(friday, "2027-01-24", "2027-01-23", "2027-01-29")).toBe("ok");
    expect(checkMove(friday, "2027-01-24", "2027-01-23", "2027-01-30")).toBe("overlapsNext");
  });
});
