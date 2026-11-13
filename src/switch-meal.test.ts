// Issue 138: the switch week (AC2, AC3) and the strict read of a switch form (AC6), the two rules the Upcoming weeks
// page and `switchMeal` share. Their edges are tested here and nowhere else: the action and the page take one accepted
// and one refused case through them. The rows are built by `upcomingRows`, as the page and the action build them, from
// listed weeks and a member's ledger; only a week's marker, its paid row and its cutoff decide the switch week.
import { describe, expect, it } from "vitest";
import { upcomingRows } from "./account-weeks.js";
import { pickupWeek, type AdminWeek } from "./pickup-week.js";
import type { MemberWeeks } from "./ports/repository.js";
import type { ProductWithOptions } from "./products.js";
import { strictChoices, switchWeek } from "./switch-meal.js";

const PRODUCT: ProductWithOptions = {
  id: "product",
  name: "Supper Club",
  cap: 50,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes: [
    {
      id: "size",
      name: "How many people",
      position: 1,
      options: [
        { id: "four", name: "Portioned for 4", priceCents: 8000, position: 1 },
        { id: "two", name: "Portioned for 2", priceCents: 4200, position: 2 },
      ],
    },
    {
      id: "menu",
      name: "Which menu",
      position: 2,
      options: [
        { id: "standard", name: "Standard", priceCents: 0, position: 1 },
        { id: "vegan", name: "Vegan", priceCents: 0, position: 2 },
      ],
    },
  ],
};

const FEB_7 = "2027-02-07";
const FEB_14 = "2027-02-14";
const FEB_21 = "2027-02-21";

/** A listed week: an ordinary Sunday and Monday, open unless closed, its cutoff to come unless passed. */
const week = (weekOf: string, { closed = false, cutoffPassed = false } = {}): AdminWeek => {
  const closedAt = closed ? new Date("2027-01-20T15:00:00.000Z") : null;
  return { ...pickupWeek(weekOf, null), cutoff: new Date(`${weekOf}T05:00:00.000Z`), closedAt, note: null, moved: false, cutoffPassed, canReopen: closed };
};

/** A member's ledger: the weeks paid, the weeks their unspent week credits were granted for, and the weeks skipped. */
const ledger = ({ paid = [], weekCredits = [], skipped = [] }: { paid?: string[]; weekCredits?: string[]; skipped?: string[] } = {}): MemberWeeks => ({
  paid: paid.map((weekOf) => ({ weekOf, amountCents: 4500, weekCredit: false, options: [] })),
  weekCredits: weekCredits.map((grantedForWeek) => ({ grantedForWeek })),
  skipped,
});

const switchWeekOf = (weeks: AdminWeek[], member: MemberWeeks = ledger()): string | null => switchWeek(upcomingRows(weeks, member, PRODUCT));

describe("AC2 — switchWeek: the week a switch starts from", () => {
  it("AC2: the first listed week that is coming, before its cutoff, is the switch week", () => {
    expect(switchWeekOf([week(FEB_7), week(FEB_14)])).toBe(FEB_7);
  });

  it("AC2: a paid week before its cutoff is passed over, to the next", () => {
    expect(switchWeekOf([week(FEB_7), week(FEB_14)], ledger({ paid: [FEB_7] }))).toBe(FEB_14);
  });

  it("AC2: a week a week credit lands on is passed over, to the next", () => {
    // January 31 paid and closed: its week credit lands on February 7.
    expect(switchWeekOf([week(FEB_7), week(FEB_14)], ledger({ weekCredits: ["2027-01-31"] }))).toBe(FEB_14);
  });

  it("AC2: a closed week with a paid row is passed over, to the next", () => {
    expect(switchWeekOf([week(FEB_7, { closed: true }), week(FEB_14)], ledger({ paid: [FEB_7] }))).toBe(FEB_14);
  });

  it("AC2: a skipped week can be the switch week", () => {
    expect(switchWeekOf([week(FEB_7), week(FEB_14)], ledger({ skipped: [FEB_7] }))).toBe(FEB_7);
  });

  it("AC2: a closed week with no paid row can be the switch week", () => {
    expect(switchWeekOf([week(FEB_7, { closed: true }), week(FEB_14)])).toBe(FEB_7);
  });

  it("AC2: with no listed week that qualifies, there is none: null, which guards the cases above", () => {
    // February 7 skipped past its cutoff, February 14 paid, and January 31's week credit landing on February 21.
    const weeks = [week(FEB_7, { cutoffPassed: true }), week(FEB_14), week(FEB_21)];
    expect(switchWeekOf(weeks, ledger({ paid: [FEB_14], weekCredits: ["2027-01-31"], skipped: [FEB_7] }))).toBeNull();
    expect(switchWeekOf([])).toBeNull();
  });
});

describe("AC3 — switchWeek: before a week's cutoff a switch reaches it; after, the next", () => {
  it.each([
    ["coming", ledger()],
    ["skipped", ledger({ skipped: [FEB_7] })],
  ])("AC3: a %s week whose cutoff has passed is not the switch week: the next one is", (_marker, member) => {
    expect(switchWeekOf([week(FEB_7, { cutoffPassed: true }), week(FEB_14)], member)).toBe(FEB_14);
  });

  it("AC3: a closed week with no paid row whose cutoff has passed is not the switch week: the next one is", () => {
    expect(switchWeekOf([week(FEB_7, { closed: true, cutoffPassed: true }), week(FEB_14)])).toBe(FEB_14);
  });
});

const form = (fields: [string, string][]): FormData => {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
};

describe("AC6 — strictChoices: the switch form, read strictly", () => {
  it("AC6: a form naming one of each type's options gives each type's choice, keyed by type id", () => {
    expect(
      strictChoices(
        PRODUCT,
        form([
          ["size", "two"],
          ["menu", "vegan"],
        ]),
      ),
    ).toEqual({ size: "two", menu: "vegan" });
  });

  it("AC6: fields that name no option type are ignored: the week, and Next's action fields", () => {
    expect(
      strictChoices(
        PRODUCT,
        form([
          ["week", FEB_14],
          ["$ACTION_ID_0123456789abcdef", ""],
          ["$ACTION_REF_1", ""],
          ["size", "four"],
          ["menu", "standard"],
        ]),
      ),
    ).toEqual({ size: "four", menu: "standard" });
  });

  it.each([
    ["no option at all", "no-such-option"],
    ["another type's option", "standard"],
    ["empty", ""],
  ])("AC6: an option that is not one of the type's (%s) is refused: null", (_what, value) => {
    expect(
      strictChoices(
        PRODUCT,
        form([
          ["size", value],
          ["menu", "vegan"],
        ]),
      ),
    ).toBeNull();
  });

  it("AC6: a missing option type is refused: null, not the type's first option", () => {
    expect(strictChoices(PRODUCT, form([["size", "two"]]))).toBeNull();
  });

  it("AC6: two options for one type are refused: null, though both are the type's", () => {
    expect(
      strictChoices(
        PRODUCT,
        form([
          ["size", "two"],
          ["size", "four"],
          ["menu", "vegan"],
        ]),
      ),
    ).toBeNull();
  });
});
