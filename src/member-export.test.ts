// Issue 59, AC8–AC10: the spreadsheet's columns, order and cells. Read back through a CSV parser, so a
// test sees what a spreadsheet would, whichever way a cell was quoted.
import { describe, expect, it } from "vitest";
import { parseCsv } from "./member-export-test-helpers.js";
import { subscribersCsv } from "./member-export.js";
import type { Subscriber } from "./ports/repository.js";

const TYPES = ["How many people?", "Which menu?"];
const HEADER = ["Last name", "First name", "Email", "Phone", ...TYPES, "Joined"];

let serial = 0;

const row = (over: Partial<Subscriber> = {}): Subscriber => ({
  subscriptionId: `subscription-${++serial}`,
  firstName: "Rosa",
  lastName: "Bennett",
  email: "rosa@example.com",
  phone: "216-555-0187",
  options: [
    { typeName: "How many people?", optionName: "2 people" },
    { typeName: "Which menu?", optionName: "Vegan" },
  ],
  joinedDate: "2026-12-01",
  ...over,
});

/** The cells of the one row `over` makes, by column. */
const cells = (over: Partial<Subscriber>): Record<string, string | undefined> => {
  const [header = [], first = []] = parseCsv(subscribersCsv(TYPES, [row(over)]));
  return Object.fromEntries(header.map((name, at) => [name, first[at]]));
};

const expectNeutralised = (cell: string | undefined, typed: string): void => {
  expect(cell).toContain(typed);
  expect(cell).not.toMatch(/^\s*[=+\-@]/);
};

describe("AC8 — the order", () => {
  it("AC8: last-name order then first-name, whatever order the rows arrive in", () => {
    const rows = [
      row({ lastName: "Nguyen", firstName: "Tam", email: "tam@example.com" }),
      row({ lastName: "abara", firstName: "Chidi", email: "chidi@example.com" }),
      row({ lastName: "Nguyen", firstName: "Lan", email: "lan@example.com" }),
      row({ lastName: "Bennett", firstName: "Rosa", email: "rosa@example.com" }),
    ];
    expect(parseCsv(subscribersCsv(TYPES, rows)).slice(1).map((record) => record[2])).toEqual([
      "chidi@example.com",
      "rosa@example.com",
      "lan@example.com",
      "tam@example.com",
    ]);
  });

  it("AC8: a row with no last name sorts as an empty string, first", () => {
    const rows = [row({ email: "named@example.com" }), row({ lastName: null, firstName: null, email: "blank@example.com" })];
    expect(parseCsv(subscribersCsv(TYPES, rows)).slice(1).map((record) => record[2])).toEqual(["blank@example.com", "named@example.com"]);
  });

  it("AC8: it leaves the list it was handed in its order", () => {
    const rows = [row({ lastName: "Nguyen" }), row({ lastName: "Abara" })];
    const given = [...rows];
    expect(subscribersCsv(TYPES, given)).not.toBe("");
    expect(given).toEqual(rows);
  });
});

describe("AC9 — the columns", () => {
  it("AC9: Last name, First name, Email, Phone, one column per option type headed with its name, Joined", () => {
    expect(parseCsv(subscribersCsv(TYPES, [row()]))).toEqual([HEADER, ["Bennett", "Rosa", "rosa@example.com", "216-555-0187", "2 people", "Vegan", "2026-12-01"]]);
  });

  it("AC9: with no rows the file is the header row", () => {
    expect(parseCsv(subscribersCsv(TYPES, []))).toEqual([HEADER]);
  });

  it("AC9: a third option type adds a column", () => {
    const options = [...row().options, { typeName: "Which pickup?", optionName: "Sunday" }];
    expect(parseCsv(subscribersCsv([...TYPES, "Which pickup?"], [row({ options })]))).toEqual([
      ["Last name", "First name", "Email", "Phone", ...TYPES, "Which pickup?", "Joined"],
      ["Bennett", "Rosa", "rosa@example.com", "216-555-0187", "2 people", "Vegan", "Sunday", "2026-12-01"],
    ]);
  });

  it("AC9: the column order is the option types', not the order a row's options arrive in", () => {
    expect(cells({ options: [...row().options].reverse() })).toMatchObject({ "How many people?": "2 people", "Which menu?": "Vegan" });
  });

  it("AC9: a row with no pick for a type leaves that column empty and the others in place", () => {
    const options = [{ typeName: "Which menu?", optionName: "Vegan" }];
    expect(cells({ options })).toMatchObject({ "How many people?": "", "Which menu?": "Vegan", Joined: "2026-12-01" });
  });

  it("AC9: a null name or phone is an empty cell", () => {
    expect(cells({ firstName: null, lastName: null, phone: null })).toMatchObject({ "Last name": "", "First name": "", Phone: "" });
  });
});

describe("AC10 — the CSV rules", () => {
  it.each([
    ["a comma", "Bennett, Jr."],
    ["a quote", 'Rosa "Ro" Bennett'],
    ["a newline", "Bennett\nJr."],
  ])("AC10: a cell holding %s comes back whole, in its own column", (_what, lastName) => {
    expect(cells({ lastName })).toMatchObject({ "Last name": lastName, "First name": "Rosa", Email: "rosa@example.com" });
  });

  it("AC10: a quote is doubled inside a quoted cell", () => {
    expect(subscribersCsv(TYPES, [row({ lastName: 'say "hi"' })])).toContain('"say ""hi"""');
  });

  it("AC10: every row keeps its own line when one cell holds a newline", () => {
    const rows = [row({ lastName: "Abara\nJr.", email: "a@example.com" }), row({ lastName: "Bennett", email: "b@example.com" })];
    expect(parseCsv(subscribersCsv(TYPES, rows))).toHaveLength(3);
  });

  it("AC10: an ordinary cell stays exactly as typed", () => {
    expect(cells({ lastName: "O'Brien-Smith", firstName: "Ana María" })).toMatchObject({ "Last name": "O'Brien-Smith", "First name": "Ana María" });
  });
});

describe("AC10 — a formula", () => {
  describe.each(["=1+1", "+1+1", "-1+1", "@SUM(1)"])("a cell starting like %s", (typed) => {
    it.each([
      ["Last name", { lastName: typed }],
      ["First name", { firstName: typed }],
      ["Email", { email: typed }],
    ] as const)("AC10: is neutralised in %s", (column, over) => {
      expectNeutralised(cells(over)[column], typed);
    });

    it("AC10: is neutralised in an option's column", () => {
      expectNeutralised(cells({ options: [{ typeName: "Which menu?", optionName: typed }] })["Which menu?"], typed);
    });

    it("AC10: is neutralised in an option type's heading", () => {
      expectNeutralised(parseCsv(subscribersCsv([typed], [row()]))[0]?.[4], typed);
    });
  });

  it.each(["=1+1", "@216", "+1 216 ext 5", "-1+cmd", "=216"])("AC10: %j is not a phone number, so it is neutralised in the Phone column", (phone) => {
    expectNeutralised(cells({ phone }).Phone, phone);
  });

  it.each(["+1 (216) 555-0142", "216-555-0142", "(216) 555.0142", "216 555 0142", "-216 555 0142", "+12165550142"])(
    "AC10: the phone number %j stays as typed",
    (phone) => {
      expect(cells({ phone }).Phone).toBe(phone);
    },
  );

  it("AC10: the phone exception is the Phone column's only: +1 216 is neutralised anywhere else", () => {
    const typed = "+1 216";
    const out = cells({ firstName: typed, lastName: typed, email: typed, options: [{ typeName: "Which menu?", optionName: typed }] });
    expectNeutralised(out["First name"], typed);
    expectNeutralised(out["Last name"], typed);
    expectNeutralised(out.Email, typed);
    expectNeutralised(out["Which menu?"], typed);
  });

  it("AC10: a cell needing both is neutralised and escaped, and stays one cell", () => {
    const typed = '=1,"2"';
    const out = cells({ lastName: typed });
    expectNeutralised(out["Last name"], typed);
    expect(out["First name"]).toBe("Rosa");
  });
});
