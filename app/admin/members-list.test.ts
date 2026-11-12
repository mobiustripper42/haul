// Issue 59, AC3, AC5 and AC6: the members list, `MembersList` rendered through react-dom/server with the
// rows it is given and a stand-in for the words the page translates, so what is read is the list's own
// markup, not the page's. What the page gives it (which rows, in which words) is app/admin/page.test.ts's;
// searching and sorting as the admin types is e2e/admin-members.spec.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Subscriber } from "@core/ports/repository.js";
import { attributesOf, textsOf } from "../screen-test-helpers";
import { MembersList, type MembersListText } from "./members-list";

const TEXT: MembersListText = {
  search: "Find a member",
  searchPlaceholder: "Type to find",
  noMatch: 'None for "{q}"',
  columns: { name: "Who", email: "Mail", phone: "Ring", meal: "Food", joined: "When", status: "State" },
  status: { active: "On", cancelled: "Off" },
  refundOwed: "Owed back",
  sortBy: "Order by",
  sortLabels: { name: "By who", joined: "By when", meal: "By food", status: "By state" },
  joinedLine: "{meal} since {date}",
};

let made = 0;
const subscriber = (over: Partial<Subscriber> = {}): Subscriber => ({
  subscriptionId: `subscription-${++made}`,
  firstName: "Rosa",
  lastName: "Bennett",
  email: "rosa@example.com",
  phone: "(216) 555-0187",
  options: [
    { typeName: "How many people?", optionName: "2 people" },
    { typeName: "Which menu?", optionName: "Vegan" },
  ],
  joinedDate: "2026-12-01",
  status: "active",
  refundOwed: false,
  ...over,
});

const ROSA = subscriber();
const CHIDI = subscriber({ firstName: "Chidi", lastName: "Abara", email: "chidi@example.com", phone: "(216) 555-0142", joinedDate: "2026-12-11" });
const MARCO = subscriber({ firstName: "Marco", lastName: "Castillo", email: "marco@example.com", phone: "(440) 555-0123" });

const render = (rows: Subscriber[]) => renderToStaticMarkup(createElement(MembersList, { rows, text: TEXT, language: "en" }));

/** The cells of each table row, each as its text. */
const tableRows = (html: string): string[][] => {
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row = ""]) =>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, cell = ""]) => textsOf(cell).join(" ")),
  );
};

/** Each column header: its word, its aria-sort, and whether a button sorts it. */
const tableHeaders = (html: string) => {
  const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? "";
  return [...head.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)].map(([, attributes = "", cell = ""]) => ({
    word: textsOf(cell)[0],
    ariaSort: attributesOf(`<th${attributes}>`, "th")[0]?.["aria-sort"],
    sorts: attributesOf(cell, "button").length === 1,
  }));
};

describe("AC3 — the rows", () => {
  it('AC3: a row reads "Last, First", email, phone, the meal, the joined date and the Active badge', () => {
    expect(tableRows(render([ROSA]))).toEqual([["Bennett, Rosa", "rosa@example.com", "(216) 555-0187", "2 people · Vegan", "Dec 1", TEXT.status.active]]);
  });

  it("AC3: there is one row for each row it is given", () => {
    expect(tableRows(render([ROSA, CHIDI, MARCO]))).toHaveLength(3);
  });

  it("AC3: a member with no name and no phone has empty cells, not the word null", () => {
    const ada = subscriber({ firstName: null, lastName: null, phone: null, email: "ada@example.com" });
    expect(tableRows(render([ada]))).toEqual([["", "ada@example.com", "", "2 people · Vegan", "Dec 1", TEXT.status.active]]);
  });

  it("AC3: the columns show the six column words it is given, in order: name, email, phone, meal, joined, status", () => {
    const { name, email, phone, meal, joined, status } = TEXT.columns;
    expect(tableHeaders(render([ROSA])).map((header) => header.word)).toEqual([name, email, phone, meal, joined, status]);
  });
});

describe("AC5 — the list as it opens", () => {
  it("AC5: it opens sorted by name, ascending, whatever order the rows come in", () => {
    expect(tableRows(render([MARCO, ROSA, CHIDI])).map((row) => row[0])).toEqual(["Abara, Chidi", "Bennett, Rosa", "Castillo, Marco"]);
  });

  it("AC5: the search field is empty and holds the placeholder, and the label's words are on the page", () => {
    const html = render([ROSA]);
    const [field, ...others] = attributesOf(html, "input").filter((input) => input.type === "search");
    expect(others).toEqual([]);
    expect(field?.placeholder).toBe(TEXT.searchPlaceholder);
    expect(field?.value ?? "").toBe("");
    expect(textsOf(html)).toContain(TEXT.search);
  });
});

describe("AC6 — the headers as the list opens", () => {
  it("AC6: Name carries aria-sort ascending, and Meal, Joined and Status carry none", () => {
    const headers = tableHeaders(render([ROSA]));
    const ariaSort = (word: string) => headers.find((header) => header.word === word)?.ariaSort;
    expect([TEXT.columns.name, TEXT.columns.meal, TEXT.columns.joined, TEXT.columns.status].map(ariaSort)).toEqual(["ascending", "none", "none", "none"]);
  });

  it("AC6: Name, Meal, Joined and Status have a sort button, and Email and Phone do not", () => {
    const sorting = tableHeaders(render([ROSA])).filter((header) => header.sorts);
    expect(sorting.map((header) => header.word)).toEqual([TEXT.columns.name, TEXT.columns.meal, TEXT.columns.joined, TEXT.columns.status]);
  });
});

// Issue 139: each row reads its own status, a cancelled row with a refund owed says so beside its badge, and each
// name links to the row's member page, in the table and on the stacked rows below 720px. Which rows are cancelled
// and owe a refund is listSubscribers' (src/adapters/signup-contract.ts); the words are the page's (app/admin/page.test.ts).
describe("AC4, AC9 (issue 139) — status, refund owed and the member page", () => {
  /** The stacked rows' items, each as its runs of text. */
  const stackedRows = (html: string): string[][] =>
    [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, inner = ""]) => textsOf(inner));

  /** Each link inside the table's body, then inside the stacked rows: where it goes and its text. */
  const linksIn = (html: string, part: "table" | "stacked"): { href: string; text: string }[] => {
    const scope =
      part === "table"
        ? (/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "")
        : [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, inner = ""]) => inner).join("");
    return [...scope.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
      href: attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "",
      text: textsOf(inner).join(" "),
    }));
  };

  const CANCELLED = subscriber({ firstName: "Chidi", lastName: "Abara", email: "chidi@example.com", status: "cancelled" });
  const OWED = subscriber({ firstName: "Marco", lastName: "Castillo", email: "marco@example.com", status: "cancelled", refundOwed: true });

  it("AC9: the status cell and the stacked row's badge read each row's own status: Active or Cancelled", () => {
    const html = render([ROSA, CANCELLED]);
    expect(tableRows(html).map((row) => row.at(-1))).toEqual([TEXT.status.cancelled, TEXT.status.active]);
    expect(stackedRows(html).map((row) => row.slice(0, 2))).toEqual([
      ["Abara, Chidi", TEXT.status.cancelled],
      ["Bennett, Rosa", TEXT.status.active],
    ]);
  });

  it("AC4: a cancelled row with a refund owed adds Refund owed beside its badge, in the status cell and in the stacked row; the others do not", () => {
    const html = render([ROSA, CANCELLED, OWED]);
    expect(tableRows(html).map((row) => row.at(-1))).toEqual([TEXT.status.cancelled, TEXT.status.active, `${TEXT.status.cancelled} ${TEXT.refundOwed}`]);
    expect(stackedRows(html).map((row) => row.slice(0, 3))).toEqual([
      ["Abara, Chidi", TEXT.status.cancelled, expect.not.stringMatching(TEXT.refundOwed)],
      ["Bennett, Rosa", TEXT.status.active, expect.not.stringMatching(TEXT.refundOwed)],
      ["Castillo, Marco", TEXT.status.cancelled, TEXT.refundOwed],
    ]);
  });

  it("AC9: each row's name links to /admin/members/<its subscription>, in the table and on the stacked rows", () => {
    const html = render([ROSA, CANCELLED]);
    const wanted = [
      { href: `/admin/members/${CANCELLED.subscriptionId}`, text: "Abara, Chidi" },
      { href: `/admin/members/${ROSA.subscriptionId}`, text: "Bennett, Rosa" },
    ];
    expect(linksIn(html, "table")).toEqual(wanted);
    expect(linksIn(html, "stacked")).toEqual(wanted);
  });
});
