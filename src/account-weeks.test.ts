// Issue 155: the rules of a member's Upcoming weeks (AC3–AC5) and History (AC6, AC7), on weeks given as the
// calendar lists them. Which weeks are listed, and the cut between the two lists, is upcomingWeeks' and pastWeeks'
// (src/pickup-week.test.ts); what each row says on screen is each page's test. Only `weekOf` and `closedAt` decide a
// row here, and the product's cutoff a Coming week's charge date; the rest of each week is carried along.
import { describe, expect, it } from "vitest";
import { historyRows, upcomingRows, type HistoryRow, type UpcomingRow } from "./account-weeks.js";
import { pickupWeek, type AdminWeek } from "./pickup-week.js";
import type { MemberWeeks } from "./ports/repository.js";
import type { ProductWithOptions } from "./products.js";

const PRODUCT: ProductWithOptions = {
  id: "product",
  name: "Supper Club",
  cap: 50,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes: [],
};

/** A listed week: an ordinary Sunday and Monday, open unless closed. */
const week = (weekOf: string, { closed = false } = {}): AdminWeek => {
  const closedAt = closed ? new Date("2027-01-20T15:00:00.000Z") : null;
  return { ...pickupWeek(weekOf, null), cutoff: new Date(`${weekOf}T05:00:00.000Z`), closedAt, note: null, moved: false, cutoffPassed: false, canReopen: closed };
};

const sundays = (first: string, count: number, step = 7): string[] =>
  Array.from({ length: count }, (_, i) => new Date(Date.parse(`${first}T00:00:00Z`) + i * step * 86_400_000).toISOString().slice(0, 10));

const FEB_7 = "2027-02-07";
const FEB_14 = "2027-02-14";
const FEB_21 = "2027-02-21";
const FEB_28 = "2027-02-28";
const MAR_7 = "2027-03-07";

/** A member's ledger: the weeks paid, at 4500 each unless given, and the weeks their unspent week credits were granted for. */
const member = (paid: (string | [string, number])[], weekCredits: string[] = []): MemberWeeks => ({
  paid: paid.map((row) => (typeof row === "string" ? { weekOf: row, amountCents: 4500, options: [] } : { weekOf: row[0], amountCents: row[1], options: [] })),
  weekCredits: weekCredits.map((grantedForWeek) => ({ grantedForWeek })),
  skipped: [],
});

/** Issue 137: the same ledger with skipped rows for `skipped`. */
const skipping = (ledger: MemberWeeks, skipped: string[]): MemberWeeks => ({ ...ledger, skipped });

/** Issue 137: a listed week whose cutoff has passed. */
const pastCutoff = (listed: AdminWeek): AdminWeek => ({ ...listed, cutoffPassed: true });

const markers = (rows: UpcomingRow[]) => rows.map((row) => [row.week.weekOf, row.marker]);
const rowOf = <Row extends { week: AdminWeek }>(rows: Row[], weekOf: string): Row | undefined => rows.find((row) => row.week.weekOf === weekOf);

describe("AC3 (issue 155) — upcomingRows: one marker a week", () => {
  it("AC3: one row per listed week, in the order given, each carrying its week", () => {
    const weeks = sundays(FEB_7, 12).map((weekOf) => week(weekOf));
    expect(upcomingRows(weeks, member([]), PRODUCT).map((row) => row.week)).toEqual(weeks);
  });

  it("AC3: an open week with no paid row is Coming, charged at the end of its cutoff Monday: February 1 for February 7", () => {
    expect(upcomingRows([week(FEB_7)], member([]), PRODUCT)).toEqual([{ week: week(FEB_7), marker: "coming", closedPaid: false, chargeDate: "2027-02-01", action: "skip" }]);
  });

  it("AC3: the charge date is the product's cutoff weekday, not a Monday in the code: Friday, February 5", () => {
    const friday = { ...PRODUCT, cutoffWeekday: 5, cutoffTime: "18:00:00" };
    expect(upcomingRows([week(FEB_7)], member([]), friday)[0]?.chargeDate).toBe("2027-02-05");
  });

  it("AC3: an open week with a paid row is Paid, with no charge date", () => {
    expect(upcomingRows([week(FEB_7)], member([FEB_7]), PRODUCT)).toEqual([{ week: week(FEB_7), marker: "paid", closedPaid: false, chargeDate: null, action: null }]);
  });

  it("AC3: a closed week is Closed whether or not it was paid, with no charge date", () => {
    const rows = upcomingRows([week(FEB_7, { closed: true }), week(FEB_14, { closed: true })], member([FEB_7]), PRODUCT);
    expect(rows.map((row) => [row.marker, row.chargeDate])).toEqual([
      ["closed", null],
      ["closed", null],
    ]);
  });

  it("AC3: another week's paid row does not make a week Paid", () => {
    expect(markers(upcomingRows([week(FEB_7), week(FEB_14)], member([FEB_14]), PRODUCT))).toEqual([
      [FEB_7, "coming"],
      [FEB_14, "paid"],
    ]);
  });
});

describe("AC4 (issue 155) — upcomingRows: a closed week that was paid", () => {
  it("AC4: closedPaid is true for a closed week with a paid row, and false for a closed week with none and for an open paid week", () => {
    const rows = upcomingRows([week(FEB_7, { closed: true }), week(FEB_14, { closed: true }), week(FEB_21)], member([FEB_7, FEB_21]), PRODUCT);
    expect(rows.map((row) => [row.week.weekOf, row.marker, row.closedPaid])).toEqual([
      [FEB_7, "closed", true],
      [FEB_14, "closed", false],
      [FEB_21, "paid", false],
    ]);
  });
});

describe("AC5 (issue 155) — upcomingRows: where a week credit lands", () => {
  it("AC5: it sits on the first listed week after the one it was granted for that is open and not paid, made and not charged", () => {
    const weeks = [week(FEB_7), week(FEB_14, { closed: true }), week(FEB_21), week(FEB_28, { closed: true }), week(MAR_7), week("2027-03-14")];
    const rows = upcomingRows(weeks, member([FEB_7, FEB_14, FEB_21], [FEB_14]), PRODUCT);
    expect(markers(rows)).toEqual([
      [FEB_7, "paid"],
      [FEB_14, "closed"],
      [FEB_21, "paid"],
      [FEB_28, "closed"],
      [MAR_7, "weekCredit"],
      ["2027-03-14", "coming"],
    ]);
    expect(rowOf(rows, MAR_7)).toMatchObject({ closedPaid: false, chargeDate: null });
  });

  it("AC5: it never sits on a week before the one it was granted for, though that week is open and not paid", () => {
    const rows = upcomingRows([week(FEB_7), week(FEB_14, { closed: true }), week(FEB_21)], member([FEB_14], [FEB_14]), PRODUCT);
    expect(markers(rows)).toEqual([
      [FEB_7, "coming"],
      [FEB_14, "closed"],
      [FEB_21, "weekCredit"],
    ]);
  });

  it("AC5: two week credits land on two weeks, in date order: a week carrying one is passed over by the next", () => {
    const weeks = [week(FEB_7), week(FEB_14), week(FEB_21)];
    expect(markers(upcomingRows(weeks, member([], ["2027-01-24", "2027-01-31"]), PRODUCT))).toEqual([
      [FEB_7, "weekCredit"],
      [FEB_14, "weekCredit"],
      [FEB_21, "coming"],
    ]);
  });

  it("AC5: a week credit for which no listed week qualifies shows on none", () => {
    const weeks = [week(FEB_7), week(FEB_14), week(FEB_21, { closed: true }), week(FEB_28)];
    const rows = upcomingRows(weeks, member([FEB_28, FEB_21], [FEB_21]), PRODUCT);
    expect(markers(rows)).toEqual([
      [FEB_7, "coming"],
      [FEB_14, "coming"],
      [FEB_21, "closed"],
      [FEB_28, "paid"],
    ]);
  });
});

describe("AC6 (issue 155) — historyRows: which past weeks are listed", () => {
  it("AC6: a past week with a paid ledger row or closed is listed, in the order given; one with neither is left out", () => {
    const weeks = [week("2027-01-31"), week("2027-01-24"), week("2027-01-17", { closed: true }), week("2027-01-10")];
    expect(historyRows(weeks, member(["2027-01-24"]), "2027-01-03").map((row) => row.week)).toEqual([week("2027-01-24"), week("2027-01-17", { closed: true })]);
  });
});

describe("AC7 (issue 155) — historyRows: each row's marker, amount and line", () => {
  const JAN_3 = "2027-01-03";
  const only = (weeks: AdminWeek[], ledger: MemberWeeks): HistoryRow | undefined => historyRows(weeks, ledger, JAN_3)[0];

  it("AC7: the subscription's first week, paid, is Paid at signup, at the amount charged", () => {
    expect(only([week(JAN_3)], member([[JAN_3, 4500]]))).toEqual({ week: week(JAN_3), marker: "paid", amountCents: 4500, line: "signup" });
  });

  it("AC7: a later paid week is Paid, at the ledger's amount", () => {
    expect(only([week("2027-01-10")], member([JAN_3, ["2027-01-10", 5000]]))).toEqual({ week: week("2027-01-10"), marker: "paid", amountCents: 5000, line: "paid" });
  });

  it("AC7: a closed week with no charge is No meal, Closed, at 0", () => {
    const closed = week("2027-01-17", { closed: true });
    expect(only([closed], member([JAN_3]))).toEqual({ week: closed, marker: "noMeal", amountCents: 0, line: "closed" });
  });

  it("AC7: a week closed after it was paid is No meal, with the closed-after-paid line and the amount charged", () => {
    const closed = week("2027-01-24", { closed: true });
    expect(only([closed], member([JAN_3, ["2027-01-24", 5000]]))).toEqual({ week: closed, marker: "noMeal", amountCents: 5000, line: "closedPaid" });
  });

  it("AC7: the subscription's first week closed after it was paid takes the closed-after-paid line, not Paid at signup", () => {
    const closed = week(JAN_3, { closed: true });
    expect(only([closed], member([[JAN_3, 4500]]))).toMatchObject({ marker: "noMeal", amountCents: 4500, line: "closedPaid" });
  });
});

// Issue 137: Skip and Unskip. Each row's `action` is the one rule the page draws its button from and the server
// actions check a request against, so its edges are tested here and nowhere else.
const actions = (rows: UpcomingRow[]) => rows.map((row) => [row.week.weekOf, row.marker, row.action]);

describe("AC1 (issue 137) — upcomingRows: a skipped week", () => {
  it("AC1: an open week with a skipped row is Skipped, with no charge date, and its button is Unskip", () => {
    expect(upcomingRows([week(FEB_7)], skipping(member([]), [FEB_7]), PRODUCT)).toEqual([
      { week: week(FEB_7), marker: "skipped", closedPaid: false, chargeDate: null, action: "unskip" },
    ]);
  });
});

describe("AC6 (issue 137) — upcomingRows: each week's button", () => {
  it("AC6: Coming and Week credit weeks have Skip, a Skipped week has Unskip, Paid and Closed weeks have none", () => {
    const weeks = [week(FEB_7, { closed: true }), week(FEB_14), week(FEB_21), week(FEB_28), week(MAR_7)];
    const ledger = skipping(member([FEB_7, FEB_14], [FEB_7]), [FEB_28]);
    expect(actions(upcomingRows(weeks, ledger, PRODUCT))).toEqual([
      [FEB_7, "closed", null],
      [FEB_14, "paid", null],
      [FEB_21, "weekCredit", "skip"],
      [FEB_28, "skipped", "unskip"],
      [MAR_7, "coming", "skip"],
    ]);
  });

  it("AC6: a closed week with a skipped row is Closed, with no button: closed wins; reopened, it is Skipped again", () => {
    const ledger = skipping(member([]), [FEB_7]);
    expect(actions(upcomingRows([week(FEB_7, { closed: true })], ledger, PRODUCT))).toEqual([[FEB_7, "closed", null]]);
    expect(actions(upcomingRows([week(FEB_7)], ledger, PRODUCT))).toEqual([[FEB_7, "skipped", "unskip"]]);
  });

  it("AC6: once a week's cutoff has passed it has no button, whatever its marker", () => {
    const weeks = [pastCutoff(week(FEB_7)), pastCutoff(week(FEB_14)), pastCutoff(week(FEB_21))];
    const ledger = skipping(member([], ["2027-01-31"]), [FEB_14]);
    expect(actions(upcomingRows(weeks, ledger, PRODUCT))).toEqual([
      [FEB_7, "weekCredit", null],
      [FEB_14, "skipped", null],
      [FEB_21, "coming", null],
    ]);
  });
});

describe("AC5 (issue 137) — upcomingRows: a skipped week takes no week credit", () => {
  it("AC5: the week credit passes over a skipped week to the next that is open, unpaid and unskipped; unskipped, it is back", () => {
    const weeks = [week(FEB_7, { closed: true }), week(FEB_14), week(FEB_21)];
    const ledger = member([FEB_7], [FEB_7]);
    expect(markers(upcomingRows(weeks, skipping(ledger, [FEB_14]), PRODUCT))).toEqual([
      [FEB_7, "closed"],
      [FEB_14, "skipped"],
      [FEB_21, "weekCredit"],
    ]);
    expect(markers(upcomingRows(weeks, ledger, PRODUCT))).toEqual([
      [FEB_7, "closed"],
      [FEB_14, "weekCredit"],
      [FEB_21, "coming"],
    ]);
  });
});

describe("AC7 (issue 137) — historyRows: a skipped week", () => {
  const JAN_3 = "2027-01-03";
  const JAN_17 = "2027-01-17";

  it("AC7: a past week with a skipped row is listed as Skipped, at 0, with the skipped line", () => {
    expect(historyRows([week(JAN_17)], skipping(member([JAN_3]), [JAN_17]), JAN_3)).toEqual([{ week: week(JAN_17), marker: "skipped", amountCents: 0, line: "skipped" }]);
  });

  it("AC7: a past week both closed and skipped is No meal, Closed, at 0: closed wins", () => {
    const closed = week(JAN_17, { closed: true });
    expect(historyRows([closed], skipping(member([JAN_3]), [JAN_17]), JAN_3)).toEqual([{ week: closed, marker: "noMeal", amountCents: 0, line: "closed" }]);
  });
});
