// Issue 140, AC1: the "Assigned to …" line the list and the editor both show. Which weeks count is assignedWeeks'
// (src/menus.test.ts); this holds the wording: each week as the calendar titles it, in week order. The wording is
// new copy, typed here once.
import { describe, expect, it } from "vitest";
import { createTranslator } from "@core/i18n.js";
import { upcomingWeeks, type ChangedWeek } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import type { Calendar } from "../weeks/calendar";
import { assignedLine } from "./assigned";

// Wednesday, February 3, 2027, noon in Cleveland: the calendar lists February 7 to April 25.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const t = createTranslator("en");

const PRODUCT: ProductWithOptions = {
  id: "product-1",
  name: "Supper Club",
  cap: 50,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes: [],
};

const calendar = (menus: Array<[string, string]>, changed: ChangedWeek[] = []): Calendar => ({
  product: PRODUCT,
  weeks: upcomingWeeks(PRODUCT, NOW, changed),
  changed,
  menus: new Map(menus),
});

describe("AC1 — assignedLine", () => {
  it('AC1: "Assigned to" each week the menu is on, titled as the calendar titles it, in week order, joined with " · "', () => {
    const line = assignedLine("autumn", calendar([["2027-02-21", "autumn"], ["2027-02-14", "autumn"], ["2027-02-28", "winter"]]), t, "en");
    expect(line).toBe("Assigned to February 14 and 15 · February 21 and 22");
  });

  it('AC1: a menu on no week reads "Not assigned to a week"', () => {
    expect(assignedLine("autumn", calendar([["2027-02-14", "winter"]]), t, "en")).toBe("Not assigned to a week");
  });

  it('AC1: a menu whose only week is closed reads "Not assigned to a week"', () => {
    const closed: ChangedWeek = { weekOf: "2027-02-14", closedAt: new Date("2027-02-02T15:00:00.000Z"), note: null, firstDay: null, lastDay: null };
    expect(assignedLine("autumn", calendar([["2027-02-14", "autumn"]], [closed]), t, "en")).toBe("Not assigned to a week");
  });
});
