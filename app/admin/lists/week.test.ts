// Issue 142: the week the weekly lists show, and its fallback, owned here. Which weeks are offered is
// `listableWeeks`'s, and which one opens is `defaultListedWeek`'s (src/pickup-week.test.ts, issue 272); the screen, the
// two downloads and the print page each take one offered and one fallen-back week through this.
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { defaultListedWeek, listableWeeks } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import { addSupperClub } from "../subscribers-fixture";
import { loadWeekLists } from "./week";

// Wednesday, February 3, 2027, noon in Cleveland. February 7 is the first upcoming week, its cutoff (the end of
// Monday, February 1) passed; February 14's cutoff is to come; January 24 and 31 are the past weeks offered, and
// April 11 the last week ahead.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const CLOSED_AT = new Date("2027-01-20T15:00:00.000Z");

let repo: InMemoryRepository;
let product: ProductWithOptions;

beforeEach(() => {
  repo = new InMemoryRepository();
  product = addSupperClub(repo);
});

const close = (weekOf: string) => repo.closePickupWeek(product.id, weekOf, null, CLOSED_AT);

describe("AC3 — the week shown", () => {
  it("AC3: with no week named it is the first upcoming week, its cutoff passed; the weeks are the ones the select offers, for the Supper Club", async () => {
    const lists = await loadWeekLists(repo, NOW, undefined);
    expect(lists.product).toEqual(product);
    expect(lists.weeks).toEqual(listableWeeks(product, NOW, []));
    expect(lists.week).toEqual(defaultListedWeek(product, NOW, [], lists.weeks));
    expect(lists.week.weekOf).toBe("2027-02-07");
    expect(lists.cutoffPassed).toBe(true);
  });

  it.each([
    ["an upcoming week before its cutoff", "2027-02-14", false],
    ["the last listed week", "2027-04-11", false],
    ["a past week", "2027-01-24", true],
  ] as const)("AC3: ?week= naming %s shows it, cutoffPassed as its cutoff says", async (_what, weekOf, cutoffPassed) => {
    const lists = await loadWeekLists(repo, NOW, weekOf);
    expect(lists.week.weekOf).toBe(weekOf);
    expect(lists.week).toEqual(lists.weeks.find((week) => week.weekOf === weekOf));
    expect(lists.cutoffPassed).toBe(cutoffPassed);
  });
});

describe("AC8 — a week the select does not offer falls back to the default", () => {
  it.each([
    ["a week after the 9 ahead", "2027-05-02"],
    ["a past week older than the 2 offered", "2027-01-03"],
    ["a date that is not a Sunday", "2027-02-13"],
    ["a date that does not exist", "2027-02-30"],
    ["text that is not a date", "next"],
    ["an empty value", ""],
  ])("AC8: %s falls back to the first upcoming week", async (_what, weekOf) => {
    const lists = await loadWeekLists(repo, NOW, weekOf);
    expect(lists.week.weekOf).toBe("2027-02-07");
    expect(lists.cutoffPassed).toBe(true);
  });

  it("AC8: a closed week, which the select leaves out, falls back too", async () => {
    await close("2027-02-14");
    const lists = await loadWeekLists(repo, NOW, "2027-02-14");
    expect(lists.weeks.map((week) => week.weekOf)).not.toContain("2027-02-14");
    expect(lists.week.weekOf).toBe("2027-02-07");
  });

  it("AC3 [Lead]: when the first upcoming week is closed, the default is the first open week after it", async () => {
    await close("2027-02-07");
    const lists = await loadWeekLists(repo, NOW, undefined);
    expect(lists.week.weekOf).toBe("2027-02-14");
    expect(lists.cutoffPassed).toBe(false);
  });
});
