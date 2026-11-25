// Issue 155: WeekList, the account pages' weeks: a list of rows, each its title and first muted line beside its badge,
// amount and action, and its later lines below (issue 230), read here as each row's runs of text, in reading order.
// What each page puts in a row is that page's test.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { textsOf } from "../../app/screen-test-helpers";
import { Badge } from "./badge";
import { WeekList, type WeekListRow } from "./week-list";

const rowsOf = (rows: WeekListRow[]): string[][] =>
  [...renderToStaticMarkup(createElement(WeekList, { rows })).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textsOf(match[1] ?? ""));

describe("AC2, AC7 (issue 155) — WeekList", () => {
  it("AC7, issue 230: one list item a row, in order, each its title and first line, its badge over its amount, then its later lines", () => {
    const rows: WeekListRow[] = [
      { id: "2027-01-10", title: "January 10 and 11", lines: ["2 people · Standard", "Paid"], amount: "$50", badge: createElement(Badge, { kind: "success", children: "Paid" }) },
      { id: "2027-01-03", title: "January 3 and 4", lines: ["Closed"], amount: "$0", badge: createElement(Badge, { kind: "closed", children: "No meal" }) },
    ];
    expect(rowsOf(rows)).toEqual([
      ["January 10 and 11", "2 people · Standard", "Paid", "$50", "Paid"],
      ["January 3 and 4", "Closed", "No meal", "$0"],
    ]);
  });

  it("AC2: a row with no amount is its title, its line, then its badge", () => {
    const row: WeekListRow = { id: "2027-02-07", title: "February 7 and 8", lines: ["Paid"], badge: createElement(Badge, { kind: "success", children: "Paid" }) };
    expect(rowsOf([row])).toEqual([["February 7 and 8", "Paid", "Paid"]]);
  });

  it("issue 230: a row reads its title, its first line, then its badge, amount and action", () => {
    const row: WeekListRow = {
      id: "2027-01-17",
      title: "January 17 and 18",
      lines: ["Charged at the end of Monday, January 11"],
      amount: "$50",
      badge: createElement(Badge, { kind: "success", children: "Paid" }),
      action: createElement("a", { href: "/skip" }, "Skip"),
    };
    expect(rowsOf([row])).toEqual([["January 17 and 18", "Charged at the end of Monday, January 11", "Paid", "$50", "Skip"]]);
  });

  it("issue 230: every line after the first is read after the action", () => {
    const row: WeekListRow = {
      id: "2027-01-24",
      title: "January 24 and 25",
      lines: ["2 people · Standard", "Closed after it was paid", "A week credit covers a later week"],
      amount: "$50",
      badge: createElement(Badge, { kind: "closed", children: "No meal" }),
      action: createElement("a", { href: "/skip" }, "Skip"),
    };
    expect(rowsOf([row])).toEqual([["January 24 and 25", "2 people · Standard", "No meal", "$50", "Skip", "Closed after it was paid", "A week credit covers a later week"]]);
  });

  it("AC3: a row with no badge is its title and its line", () => {
    const row: WeekListRow = { id: "2027-03-07", title: "March 7 and 8", lines: ["Charged at the end of Monday, March 1"] };
    expect(rowsOf([row])).toEqual([["March 7 and 8", "Charged at the end of Monday, March 1"]]);
  });

  it("AC8 (issue 243): a row's `below` is in its list item, read after its last line", () => {
    const row: WeekListRow = {
      id: "2027-03-14",
      title: "March 14 and 15",
      lines: ["2 people · Standard", "Paid"],
      action: createElement("a", { href: "/skip" }, "Skip"),
      below: createElement("p", null, "Autumn harvest"),
    };
    const plain: WeekListRow = { id: "2027-03-21", title: "March 21 and 22", lines: ["Paid"] };
    expect(rowsOf([row, plain])).toEqual([
      ["March 14 and 15", "2 people · Standard", "Skip", "Paid", "Autumn harvest"],
      ["March 21 and 22", "Paid"],
    ]);
  });
});
