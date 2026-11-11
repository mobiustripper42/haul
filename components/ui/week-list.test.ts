// Issue 155: WeekList, the account pages' weeks: a list of rows, each its title and muted lines on the left and
// its amount and badge on the right, read here as each row's runs of text. What each page puts in a row is that
// page's test.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { textsOf } from "../../app/screen-test-helpers";
import { Badge } from "./badge";
import { WeekList, type WeekListRow } from "./week-list";

const rowsOf = (rows: WeekListRow[]): string[][] =>
  [...renderToStaticMarkup(createElement(WeekList, { rows })).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textsOf(match[1] ?? ""));

describe("AC2, AC7 (issue 155) — WeekList", () => {
  it("AC7: one list item a row, in order, each its title, its lines, its amount, then its badge", () => {
    const rows: WeekListRow[] = [
      { id: "2027-01-10", title: "January 10 and 11", lines: ["2 people · Standard", "Paid"], amount: "$50", badge: createElement(Badge, { kind: "success", children: "Paid" }) },
      { id: "2027-01-03", title: "January 3 and 4", lines: ["Closed"], amount: "$0", badge: createElement(Badge, { kind: "closed", children: "No meal" }) },
    ];
    expect(rowsOf(rows)).toEqual([
      ["January 10 and 11", "2 people · Standard", "Paid", "$50", "Paid"],
      ["January 3 and 4", "Closed", "$0", "No meal"],
    ]);
  });

  it("AC2: a row with no amount is its title, its line, then its badge", () => {
    const row: WeekListRow = { id: "2027-02-07", title: "February 7 and 8", lines: ["Paid"], badge: createElement(Badge, { kind: "success", children: "Paid" }) };
    expect(rowsOf([row])).toEqual([["February 7 and 8", "Paid", "Paid"]]);
  });

  it("AC3: a row with no badge is its title and its line", () => {
    const row: WeekListRow = { id: "2027-03-07", title: "March 7 and 8", lines: ["Charged at the end of Monday, March 1"] };
    expect(rowsOf([row])).toEqual([["March 7 and 8", "Charged at the end of Monday, March 1"]]);
  });
});
