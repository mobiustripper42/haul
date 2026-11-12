// Issue 59, AC3, AC5 and AC6: what the list's search and sort do, framework-free. What the browser does
// with them is e2e/admin-members.spec.ts.
import { describe, expect, it } from "vitest";
import { compareNames, filterSubscribers, mealLabel, nextSort, sortSubscribers, subscriberName, type Sort, type SortKey } from "./member-list.js";
import type { Subscriber } from "./ports/repository.js";

let serial = 0;

const row = (over: Partial<Subscriber> = {}): Subscriber => ({
  subscriptionId: `subscription-${++serial}`,
  firstName: "Rosa",
  lastName: "Bennett",
  email: "rosa.bennett@example.com",
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

const meal = (size: string, menu: string): Subscriber["options"] => [
  { typeName: "How many people?", optionName: size },
  { typeName: "Which menu?", optionName: menu },
];

const named = (rows: Subscriber[]): string[] => rows.map((r) => `${r.lastName}, ${r.firstName}`);

describe("AC3 — the words a row shows", () => {
  it.each([
    ["both parts", { firstName: "Rosa", lastName: "Bennett" }, "Bennett, Rosa"],
    ["only a last name", { firstName: null, lastName: "Bennett" }, "Bennett"],
    ["only a first name", { firstName: "Rosa", lastName: null }, "Rosa"],
    ["neither", { firstName: null, lastName: null }, ""],
  ])("AC3: with %s the name reads as it should", (_what, parts, expected) => {
    expect(subscriberName(parts)).toBe(expected);
  });

  it('AC3: the meal is the options joined with " · ", in the order given', () => {
    expect(mealLabel(meal("2 people", "Standard"))).toBe("2 people · Standard");
    expect(mealLabel(meal("3–4 people", "Vegan"))).toBe("3–4 people · Vegan");
  });

  it("AC3: a third option type joins the same way", () => {
    expect(mealLabel([...meal("2 people", "Vegan"), { typeName: "Which pickup?", optionName: "Sunday" }])).toBe("2 people · Vegan · Sunday");
  });

  it("AC3: no options read as nothing", () => {
    expect(mealLabel([])).toBe("");
  });
});

describe("AC5 — search", () => {
  const rosa = row();
  const chidi = row({ firstName: "Chidi", lastName: "Abara", email: "chidi.abara@example.com", phone: "(440) 555-0133" });
  const linh = row({ firstName: "Linh", lastName: "Dang", email: "ld@farm.example", phone: "216.555.0166" });
  const rows = [rosa, chidi, linh];

  it("AC5: an empty search keeps every row, in the order given", () => {
    expect(filterSubscribers(rows, "")).toEqual(rows);
  });

  it.each([
    ["the first name", "rosa"],
    ["the last name", "bennett"],
    ["part of a name", "enne"],
    ['"Last, First"', "bennett, rosa"],
    ['"First Last"', "rosa bennett"],
    ["a name in another case", "ROSA BENNETT"],
    ["the email", "rosa.bennett@"],
    ["the email in another case", "ROSA.BENNETT@EXAMPLE"],
  ])("AC5: it matches on %s", (_what, query) => {
    expect(filterSubscribers(rows, query)).toEqual([rosa]);
  });

  it.each([
    ["digits alone", "4405550133"],
    ["with the same punctuation", "(440) 555-0133"],
    ["with other punctuation", "440.555.0133"],
    ["with spaces", "440 555 0133"],
    ["part of the number", "0133"],
  ])("AC5: a phone query matches the phone's digits, ignoring punctuation in both: %s", (_what, query) => {
    expect(filterSubscribers(rows, query)).toEqual([chidi]);
  });

  it("AC5: the digits match across punctuation in the stored phone", () => {
    expect(filterSubscribers(rows, "2165550166")).toEqual([linh]);
  });

  it.each(["(", ")", "-", "."])("AC5: a query of %j holds no digits, so it does not match on phone", (query) => {
    const noPunctuationInEmail = rows.map((r) => ({ ...r, email: "plain@examplecom" }));
    expect(filterSubscribers(noPunctuationInEmail, query)).toEqual([]);
  });

  it("AC5: any digits in a query match the phone: bob2 finds a phone with a 2 in it, and not one without", () => {
    expect(filterSubscribers(rows, "bob2")).toEqual([rosa, linh]);
  });

  it("AC5: the same letters with no digit match nothing, so it is the 2 that bob2 matched on", () => {
    expect(filterSubscribers(rows, "bob")).toEqual([]);
  });

  it("AC5: a row with no phone is not matched by digits, and does not throw", () => {
    const phoneless = row({ phone: null, email: "plain@example.com" });
    expect(filterSubscribers([phoneless, chidi], "0133")).toEqual([chidi]);
  });

  it("AC5: a row with a null name part is found by the part it has, and the word null finds nothing", () => {
    const lastOnly = row({ firstName: null, lastName: "Lovelace", email: "plain@example.com" });
    const firstOnly = row({ firstName: "Grace", lastName: null, email: "other@example.com" });
    expect(filterSubscribers([lastOnly, firstOnly], "lovelace")).toEqual([lastOnly]);
    expect(filterSubscribers([lastOnly, firstOnly], "grace")).toEqual([firstOnly]);
    expect(filterSubscribers([lastOnly, firstOnly], "null")).toEqual([]);
  });
});

describe("AC6 — name order", () => {
  const person = (lastName: string | null, firstName: string | null) => row({ lastName, firstName });

  it("AC6: last name decides first", () => {
    expect(compareNames(person("Abara", "Zed"), person("Bennett", "Ana"))).toBeLessThan(0);
    expect(compareNames(person("Bennett", "Ana"), person("Abara", "Zed"))).toBeGreaterThan(0);
  });

  it("AC6: first name breaks a tie on last name", () => {
    expect(compareNames(person("Dang", "Linh"), person("Dang", "Mai"))).toBeLessThan(0);
  });

  it("AC6: it is case-insensitive", () => {
    expect(compareNames(person("abara", "chidi"), person("Bennett", "Rosa"))).toBeLessThan(0);
    expect(compareNames(person("BENNETT", "ROSA"), person("bennett", "rosa"))).toBe(0);
  });

  it('AC6: the last name is compared whole: "Lee" comes before "Lee Kim", whatever the first names', () => {
    expect(compareNames(person("Lee", "Zoe"), person("Lee Kim", "Amy"))).toBeLessThan(0);
  });

  it("AC6: a null name part compares as an empty string", () => {
    expect(compareNames(person(null, "Zed"), person("Abara", "Ana"))).toBeLessThan(0);
    expect(compareNames(person("Abara", null), person("Abara", "Ana"))).toBeLessThan(0);
    expect(compareNames(person(null, null), person("", ""))).toBe(0);
  });
});

describe("AC6 — the sort", () => {
  const sorted = (rows: Subscriber[], key: SortKey, direction: Sort["direction"]) => named(sortSubscribers(rows, { key, direction }));

  const abara = row({ lastName: "Abara", firstName: "Chidi", options: meal("3–4 people", "Standard"), joinedDate: "2026-12-05" });
  const bennett = row({ lastName: "Bennett", firstName: "Rosa", options: meal("2 people", "Vegan"), joinedDate: "2026-12-01" });
  const castillo = row({ lastName: "Castillo", firstName: "Marco", options: meal("2 people", "Standard"), joinedDate: "2026-12-03" });
  const rows = [bennett, castillo, abara];

  it("AC6: by name, ascending", () => {
    expect(sorted(rows, "name", "asc")).toEqual(["Abara, Chidi", "Bennett, Rosa", "Castillo, Marco"]);
  });

  it("AC6: by name, descending", () => {
    expect(sorted(rows, "name", "desc")).toEqual(["Castillo, Marco", "Bennett, Rosa", "Abara, Chidi"]);
  });

  it("AC6: by meal, ascending, on the meal as the row shows it", () => {
    expect(sorted(rows, "meal", "asc")).toEqual(["Castillo, Marco", "Bennett, Rosa", "Abara, Chidi"]);
  });

  it("AC6: by meal, descending", () => {
    expect(sorted(rows, "meal", "desc")).toEqual(["Abara, Chidi", "Bennett, Rosa", "Castillo, Marco"]);
  });

  it("AC6: by joined, newest first", () => {
    expect(sorted(rows, "joined", "desc")).toEqual(["Abara, Chidi", "Castillo, Marco", "Bennett, Rosa"]);
  });

  it("AC6: by joined, oldest first", () => {
    expect(sorted(rows, "joined", "asc")).toEqual(["Bennett, Rosa", "Castillo, Marco", "Abara, Chidi"]);
  });

  describe("a tie breaks on name, ascending, even when the column is descending", () => {
    const tied = (over: Partial<Subscriber>) => [
      row({ lastName: "Castillo", firstName: "Marco", ...over }),
      row({ lastName: "Abara", firstName: "Chidi", ...over }),
      row({ lastName: "Bennett", firstName: "Rosa", ...over }),
    ];
    const NAMES = ["Abara, Chidi", "Bennett, Rosa", "Castillo, Marco"];

    it.each(["asc", "desc"] as const)("AC6: on meal, %s", (direction) => {
      expect(sorted(tied({ options: meal("2 people", "Vegan") }), "meal", direction)).toEqual(NAMES);
    });

    it.each(["asc", "desc"] as const)("AC6: on joined, %s", (direction) => {
      expect(sorted(tied({ joinedDate: "2026-12-01" }), "joined", direction)).toEqual(NAMES);
    });

    it.each(["asc", "desc"] as const)("AC6: on status, where every row is Active in Phase 1, %s", (direction) => {
      expect(sorted(tied({}), "status", direction)).toEqual(NAMES);
    });

    // Issue 139: the Status column reads each row's own status.
    it("AC9 (issue 139): on status, ascending, Active before Cancelled; descending, Cancelled first; ties on name, ascending, both ways", () => {
      const rows = [
        row({ lastName: "Castillo", firstName: "Marco", status: "cancelled" }),
        row({ lastName: "Abara", firstName: "Chidi" }),
        row({ lastName: "Bennett", firstName: "Rosa", status: "cancelled" }),
        row({ lastName: "Diaz", firstName: "Lena" }),
      ];
      expect(sorted(rows, "status", "asc")).toEqual(["Abara, Chidi", "Diaz, Lena", "Bennett, Rosa", "Castillo, Marco"]);
      expect(sorted(rows, "status", "desc")).toEqual(["Bennett, Rosa", "Castillo, Marco", "Abara, Chidi", "Diaz, Lena"]);
    });
  });

  it("AC6: it gives back a new list and leaves the one it was handed alone", () => {
    const given = [...rows];
    expect(sortSubscribers(given, { key: "name", direction: "asc" })).toHaveLength(3);
    expect(given).toEqual(rows);
  });
});

describe("AC6 — a click on a header", () => {
  it.each<[Sort, SortKey, Sort]>([
    [{ key: "name", direction: "asc" }, "name", { key: "name", direction: "desc" }],
    [{ key: "name", direction: "desc" }, "name", { key: "name", direction: "asc" }],
    [{ key: "meal", direction: "asc" }, "meal", { key: "meal", direction: "desc" }],
    [{ key: "status", direction: "desc" }, "status", { key: "status", direction: "asc" }],
    [{ key: "joined", direction: "desc" }, "joined", { key: "joined", direction: "asc" }],
    [{ key: "joined", direction: "asc" }, "joined", { key: "joined", direction: "desc" }],
  ])("AC6: on the sorted header reverses it: %j, clicking %s", (current, key, expected) => {
    expect(nextSort(current, key)).toEqual(expected);
  });

  it.each<[Sort, SortKey, Sort]>([
    [{ key: "name", direction: "asc" }, "meal", { key: "meal", direction: "asc" }],
    [{ key: "name", direction: "desc" }, "status", { key: "status", direction: "asc" }],
    [{ key: "joined", direction: "desc" }, "name", { key: "name", direction: "asc" }],
  ])("AC6: on another header sorts by it ascending: %j, clicking %s", (current, key, expected) => {
    expect(nextSort(current, key)).toEqual(expected);
  });

  it.each<[Sort]>([[{ key: "name", direction: "asc" }], [{ key: "meal", direction: "desc" }]])("AC6: Joined starts newest first, from %j", (current) => {
    expect(nextSort(current, "joined")).toEqual({ key: "joined", direction: "desc" });
  });
});
