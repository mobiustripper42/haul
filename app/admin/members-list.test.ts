// Issue 59, AC3, AC5 and AC6: the members list, `MembersList` rendered through react-dom/server with the
// rows it is given and a stand-in for the words the page translates, so what is read is the list's own
// markup, not the page's. What the page gives it (which rows, in which words) is app/admin/page.test.ts's;
// searching and sorting as the admin types is e2e/admin-members.spec.ts. Issue 263: the list takes people, each a
// member's current subscription and their earlier ones; issue 59's cases read one-subscription people. Vitest runs with
// no DOM, so what is read here is the list as it loads; what a press does is e2e/admin-members.spec.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MemberRow } from "@core/member-list.js";
import type { Subscriber } from "@core/ports/repository.js";
import { fill } from "../fill";
import { attributesOf, textsOf } from "../screen-test-helpers";
import { MembersList, type MembersListText } from "./members-list";

const TEXT: MembersListText = {
  search: "Find a member",
  searchPlaceholder: "Type to find",
  noMatch: 'None for "{q}"',
  columns: { name: "Who", email: "Mail", phone: "Ring", meal: "Food", joined: "When", status: "State" },
  status: { active: "On", cancelled: "Off" },
  refundOwed: "Owed back",
  cardDeclined: "Card bounced",
  sortBy: "Order by",
  sortLabels: { name: "By who", joined: "By when", meal: "By food", status: "By state" },
  joinedLine: "{meal} since {date}",
  past: "Gone by",
  earlier: "{n} before",
};

let made = 0;
const subscriber = (over: Partial<Subscriber> = {}): Subscriber => ({
  subscriptionId: `subscription-${++made}`,
  memberId: `member-${made}`,
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
  cardDeclined: false,
  ...over,
});

const ROSA = subscriber();
const CHIDI = subscriber({ firstName: "Chidi", lastName: "Abara", email: "chidi@example.com", phone: "(216) 555-0142", joinedDate: "2026-12-11" });
const MARCO = subscriber({ firstName: "Marco", lastName: "Castillo", email: "marco@example.com", phone: "(440) 555-0123" });

const render = (rows: MemberRow[]) => renderToStaticMarkup(createElement(MembersList, { rows, text: TEXT, language: "en" }));

/** Each subscription as a person holding only it. */
const alone = (...rows: Subscriber[]): MemberRow[] => rows.map((row) => ({ memberId: row.memberId, current: row, earlier: [] }));

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
    expect(tableRows(render(alone(ROSA)))).toEqual([["Bennett, Rosa", "rosa@example.com", "(216) 555-0187", "2 people · Vegan", "Dec\u00a01", TEXT.status.active]]);
  });

  it("AC3: there is one row for each row it is given", () => {
    expect(tableRows(render(alone(ROSA, CHIDI, MARCO)))).toHaveLength(3);
  });

  it("AC3: a member with no name and no phone has empty cells, not the word null", () => {
    const ada = subscriber({ firstName: null, lastName: null, phone: null, email: "ada@example.com" });
    expect(tableRows(render(alone(ada)))).toEqual([["", "ada@example.com", "", "2 people · Vegan", "Dec\u00a01", TEXT.status.active]]);
  });

  it("AC3: the columns show the six column words it is given, in order: name, email, phone, meal, joined, status", () => {
    const { name, email, phone, meal, joined, status } = TEXT.columns;
    expect(tableHeaders(render(alone(ROSA))).map((header) => header.word)).toEqual([name, email, phone, meal, joined, status]);
  });
});

describe("AC5 — the list as it opens", () => {
  it("AC5: it opens sorted by name, ascending, whatever order the rows come in", () => {
    expect(tableRows(render(alone(MARCO, ROSA, CHIDI))).map((row) => row[0])).toEqual(["Abara, Chidi", "Bennett, Rosa", "Castillo, Marco"]);
  });

  it("AC5: the search field is empty and holds the placeholder, and the label's words are on the page", () => {
    const html = render(alone(ROSA));
    const [field, ...others] = attributesOf(html, "input").filter((input) => input.type === "search");
    expect(others).toEqual([]);
    expect(field?.placeholder).toBe(TEXT.searchPlaceholder);
    expect(field?.value ?? "").toBe("");
    expect(textsOf(html)).toContain(TEXT.search);
  });
});

describe("AC6 — the headers as the list opens", () => {
  it("AC6: Name carries aria-sort ascending, and Meal, Joined and Status carry none", () => {
    const headers = tableHeaders(render(alone(ROSA)));
    const ariaSort = (word: string) => headers.find((header) => header.word === word)?.ariaSort;
    expect([TEXT.columns.name, TEXT.columns.meal, TEXT.columns.joined, TEXT.columns.status].map(ariaSort)).toEqual(["ascending", "none", "none", "none"]);
  });

  it("AC6: Name, Meal, Joined and Status have a sort button, and Email and Phone do not", () => {
    const sorting = tableHeaders(render(alone(ROSA))).filter((header) => header.sorts);
    expect(sorting.map((header) => header.word)).toEqual([TEXT.columns.name, TEXT.columns.meal, TEXT.columns.joined, TEXT.columns.status]);
  });
});

// Issue 222: the display rule is formatPhone's (src/phone.test.ts); the table's phone cell and the stacked rows'
// email · phone note show the phone through it.
describe("AC5 (issue 222) — the phone, in the table and on the stacked rows", () => {
  /** Each stacked row's last line: its email · phone note. */
  const notesOf = (html: string): (string | undefined)[] =>
    [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, inner = ""]) => textsOf(inner).at(-1));

  it("AC5: a stored 2165551234 reads (216) 555-1234 in the phone cell and in the note", () => {
    const html = render(alone(subscriber({ phone: "2165551234" })));
    expect(tableRows(html).map((row) => row[2])).toEqual(["(216) 555-1234"]);
    expect(notesOf(html)).toEqual(["rosa@example.com · (216) 555-1234"]);
  });

  it("AC5: a stored 216-555-0187, saved before ten digits were kept, reads unchanged in the phone cell and in the note", () => {
    const html = render(alone(subscriber({ phone: "216-555-0187" })));
    expect(tableRows(html).map((row) => row[2])).toEqual(["216-555-0187"]);
    expect(notesOf(html)).toEqual(["rosa@example.com · 216-555-0187"]);
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
    const html = render(alone(ROSA, CANCELLED));
    expect(tableRows(html).map((row) => row.at(-1))).toEqual([TEXT.status.cancelled, TEXT.status.active]);
    expect(stackedRows(html).map((row) => row.slice(0, 2))).toEqual([
      ["Abara, Chidi", TEXT.status.cancelled],
      ["Bennett, Rosa", TEXT.status.active],
    ]);
  });

  it("AC4: a cancelled row with a refund owed adds Refund owed beside its badge, in the status cell and in the stacked row; the others do not", () => {
    const html = render(alone(ROSA, CANCELLED, OWED));
    expect(tableRows(html).map((row) => row.at(-1))).toEqual([TEXT.status.cancelled, TEXT.status.active, `${TEXT.status.cancelled} ${TEXT.refundOwed}`]);
    expect(stackedRows(html).map((row) => row.slice(0, 3))).toEqual([
      ["Abara, Chidi", TEXT.status.cancelled, expect.not.stringMatching(TEXT.refundOwed)],
      ["Bennett, Rosa", TEXT.status.active, expect.not.stringMatching(TEXT.refundOwed)],
      ["Castillo, Marco", TEXT.status.cancelled, TEXT.refundOwed],
    ]);
  });

  // Issue 135: an active row holding a declined week says so beside its badge, as Refund owed does. Which rows hold one
  // is listSubscribers' (src/adapters/charge-run-contract.ts); the word is the page's (app/admin/page.test.ts).
  it("AC4 (issue 135): an active row with a card declined adds its word beside the badge, in the status cell and in the stacked row; the other does not", () => {
    const DECLINED = subscriber({ firstName: "Chidi", lastName: "Abara", email: "chidi@example.com", cardDeclined: true });
    const html = render(alone(ROSA, DECLINED));
    expect(tableRows(html).map((row) => row.at(-1))).toEqual([`${TEXT.status.active} ${TEXT.cardDeclined}`, TEXT.status.active]);
    expect(stackedRows(html).map((row) => row.slice(0, 3))).toEqual([
      ["Abara, Chidi", TEXT.status.active, TEXT.cardDeclined],
      ["Bennett, Rosa", TEXT.status.active, expect.not.stringMatching(TEXT.cardDeclined)],
    ]);
  });

  it("AC9: each row's name links to /admin/members/<its subscription>, in the table and on the stacked rows", () => {
    const html = render(alone(ROSA, CANCELLED));
    const wanted = [
      { href: `/admin/members/${CANCELLED.subscriptionId}`, text: "Abara, Chidi" },
      { href: `/admin/members/${ROSA.subscriptionId}`, text: "Bennett, Rosa" },
    ];
    expect(linksIn(html, "table")).toEqual(wanted);
    expect(linksIn(html, "stacked")).toEqual(wanted);
  });
});

// Issue 263: a person is one row, drawn from their current subscription, with their earlier ones rolled up under it. Which
// subscription is current is groupByMember's (src/member-list.test.ts); here the list draws what it is given.
describe("issue 263 — a person's row and their earlier subscriptions, as the list loads", () => {
  /** The stacked rows' items, each as its runs of text. */
  const stackedItems = (html: string): string[] => [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, inner = ""]) => inner);
  /** The table body's rows, each as its markup. */
  const bodyRows = (html: string): string[] => {
    const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
    return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row = ""]) => row);
  };
  /** Each link in `markup`: where it goes. */
  const hrefsIn = (markup: string): string[] => attributesOf(markup, "a").map((a) => a.href ?? "");
  /** The `aria-expanded` of each button in `markup` that carries one: a rolldown's toggle. */
  const togglesIn = (markup: string): string[] =>
    attributesOf(markup, "button")
      .map((button) => button["aria-expanded"])
      .filter((expanded): expanded is string => expanded !== undefined);

  // Rosa rejoined: her current subscription is active and her earlier one cancelled, owing a refund.
  const NOW = subscriber({
    memberId: "member-rosa",
    options: [
      { typeName: "How many people?", optionName: "3–4 people" },
      { typeName: "Which menu?", optionName: "Standard" },
    ],
    joinedDate: "2026-12-11",
    cardDeclined: true,
  });
  const THEN = subscriber({ memberId: "member-rosa", joinedDate: "2026-11-02", status: "cancelled", refundOwed: true });
  const BEFORE_THAT = subscriber({ memberId: "member-rosa", joinedDate: "2026-10-05", status: "cancelled" });
  const ROSA_REJOINED: MemberRow = { memberId: "member-rosa", current: NOW, earlier: [THEN, BEFORE_THAT] };
  const ABARA = alone(subscriber({ firstName: "Chidi", lastName: "Abara", email: "chidi@example.com" }));

  it("AC1: a person with earlier subscriptions is one row in the table and one in the stacked rows", () => {
    const html = render([ROSA_REJOINED, ...ABARA]);
    expect(bodyRows(html)).toHaveLength(2);
    expect(stackedItems(html)).toHaveLength(2);
  });

  it("AC2: the row's meal, joined date and status, with Card declined, are the current subscription's, and an earlier one's Refund owed is not raised to it", () => {
    const [cells] = tableRows(render([ROSA_REJOINED]));
    expect(cells?.slice(1)).toEqual(["rosa@example.com", "(216) 555-0187", "3–4 people · Standard", "Dec 11", `${TEXT.status.active} ${TEXT.cardDeclined}`]);
  });

  it("AC2: the stacked row's badge and joined line are the current subscription's, and an earlier one's Refund owed is not raised to it", () => {
    const [item = ""] = stackedItems(render([ROSA_REJOINED]));
    const texts = textsOf(item);
    expect(texts.slice(0, 3)).toEqual(["Bennett, Rosa", TEXT.status.active, TEXT.cardDeclined]);
    expect(texts).toContain(fill(TEXT.joinedLine, { meal: "3–4 people · Standard", date: "Dec 11" }));
    expect(texts).not.toContain(TEXT.refundOwed);
  });

  it("AC2: the name links to the current subscription's member page, in the table and on the stacked rows, and to no earlier one", () => {
    const html = render([ROSA_REJOINED]);
    expect(bodyRows(html).map(hrefsIn)).toEqual([[`/admin/members/${NOW.subscriptionId}`]]);
    expect(stackedItems(html).map(hrefsIn)).toEqual([[`/admin/members/${NOW.subscriptionId}`]]);
  });

  it("AC3: a person with earlier subscriptions has a toggle, closed on load, in their table row and their stacked row; a person with one subscription has none", () => {
    const html = render([ROSA_REJOINED, ...ABARA]);
    expect(bodyRows(html).map(togglesIn)).toEqual([[], ["false"]]);
    expect(stackedItems(html).map(togglesIn)).toEqual([[], ["false"]]);
  });

  it("AC4: Past is one button, not pressed as the list loads", () => {
    const html = render([ROSA_REJOINED, ...ABARA]);
    expect(attributesOf(html, "button").map((button) => button["aria-pressed"]).filter((pressed) => pressed !== undefined)).toEqual(["false"]);
  });
});
