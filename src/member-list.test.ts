// Issue 59, AC3, AC5 and AC6: what the list's search and sort do, framework-free. What the browser does
// with them is e2e/admin-members.spec.ts. Issue 263: search and sort run over people, each a member's current
// subscription and their earlier ones (`groupByMember`, AC1–AC3 below), so issue 59's search and sort cases read
// one-subscription people.
import { describe, expect, it } from "vitest";
import { compareNames, filterMembers, groupByMember, mealLabel, nextSort, sortMembers, subscriberName, type MemberRow, type Sort, type SortKey } from "./member-list.js";
import type { Subscriber } from "./ports/repository.js";

let serial = 0;

/** A subscription; each held by a member of its own unless `memberId` is given. */
const row = (over: Partial<Subscriber> = {}): Subscriber => ({
  subscriptionId: `subscription-${++serial}`,
  memberId: `member-${serial}`,
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
  cardDeclined: false,
  ...over,
});

const meal = (size: string, menu: string): Subscriber["options"] => [
  { typeName: "How many people?", optionName: size },
  { typeName: "Which menu?", optionName: menu },
];

/** A person: their current subscription, then their earlier ones as given. */
const person = (current: Subscriber, ...earlier: Subscriber[]): MemberRow => ({ memberId: current.memberId, current, earlier });

const named = (rows: MemberRow[]): string[] => rows.map(({ current }) => `${current.lastName}, ${current.firstName}`);

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
  const rosa = person(row());
  const chidi = person(row({ firstName: "Chidi", lastName: "Abara", email: "chidi.abara@example.com", phone: "(440) 555-0133" }));
  const linh = person(row({ firstName: "Linh", lastName: "Dang", email: "ld@farm.example", phone: "216.555.0166" }));
  const rows = [rosa, chidi, linh];

  it("AC5: an empty search keeps every row, in the order given", () => {
    expect(filterMembers(rows, "")).toEqual(rows);
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
    expect(filterMembers(rows, query)).toEqual([rosa]);
  });

  it.each([
    ["digits alone", "4405550133"],
    ["with the same punctuation", "(440) 555-0133"],
    ["with other punctuation", "440.555.0133"],
    ["with spaces", "440 555 0133"],
    ["part of the number", "0133"],
  ])("AC5: a phone query matches the phone's digits, ignoring punctuation in both: %s", (_what, query) => {
    expect(filterMembers(rows, query)).toEqual([chidi]);
  });

  it("AC5: the digits match across punctuation in the stored phone", () => {
    expect(filterMembers(rows, "2165550166")).toEqual([linh]);
  });

  it.each(["(", ")", "-", "."])("AC5: a query of %j holds no digits, so it does not match on phone", (query) => {
    const noPunctuationInEmail = rows.map((r) => person({ ...r.current, email: "plain@examplecom" }));
    expect(filterMembers(noPunctuationInEmail, query)).toEqual([]);
  });

  it("AC5: any digits in a query match the phone: bob2 finds a phone with a 2 in it, and not one without", () => {
    expect(filterMembers(rows, "bob2")).toEqual([rosa, linh]);
  });

  it("AC5: the same letters with no digit match nothing, so it is the 2 that bob2 matched on", () => {
    expect(filterMembers(rows, "bob")).toEqual([]);
  });

  it("AC5: a row with no phone is not matched by digits, and does not throw", () => {
    const phoneless = person(row({ phone: null, email: "plain@example.com" }));
    expect(filterMembers([phoneless, chidi], "0133")).toEqual([chidi]);
  });

  it("AC5: a row with a null name part is found by the part it has, and the word null finds nothing", () => {
    const lastOnly = person(row({ firstName: null, lastName: "Lovelace", email: "plain@example.com" }));
    const firstOnly = person(row({ firstName: "Grace", lastName: null, email: "other@example.com" }));
    expect(filterMembers([lastOnly, firstOnly], "lovelace")).toEqual([lastOnly]);
    expect(filterMembers([lastOnly, firstOnly], "grace")).toEqual([firstOnly]);
    expect(filterMembers([lastOnly, firstOnly], "null")).toEqual([]);
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
  const sorted = (rows: MemberRow[], key: SortKey, direction: Sort["direction"]) => named(sortMembers(rows, { key, direction }));

  const abara = person(row({ lastName: "Abara", firstName: "Chidi", options: meal("3–4 people", "Standard"), joinedDate: "2026-12-05" }));
  const bennett = person(row({ lastName: "Bennett", firstName: "Rosa", options: meal("2 people", "Vegan"), joinedDate: "2026-12-01" }));
  const castillo = person(row({ lastName: "Castillo", firstName: "Marco", options: meal("2 people", "Standard"), joinedDate: "2026-12-03" }));
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
      person(row({ lastName: "Castillo", firstName: "Marco", ...over })),
      person(row({ lastName: "Abara", firstName: "Chidi", ...over })),
      person(row({ lastName: "Bennett", firstName: "Rosa", ...over })),
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
        person(row({ lastName: "Castillo", firstName: "Marco", status: "cancelled" })),
        person(row({ lastName: "Abara", firstName: "Chidi" })),
        person(row({ lastName: "Bennett", firstName: "Rosa", status: "cancelled" })),
        person(row({ lastName: "Diaz", firstName: "Lena" })),
      ];
      expect(sorted(rows, "status", "asc")).toEqual(["Abara, Chidi", "Diaz, Lena", "Bennett, Rosa", "Castillo, Marco"]);
      expect(sorted(rows, "status", "desc")).toEqual(["Bennett, Rosa", "Castillo, Marco", "Abara, Chidi", "Diaz, Lena"]);
    });
  });

  it("AC6: it gives back a new list and leaves the one it was handed alone", () => {
    const given = [...rows];
    expect(sortMembers(given, { key: "name", direction: "asc" })).toHaveLength(3);
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

// Issue 263: one row per person. Which subscription is current, and the order of the earlier ones, are owned here; the
// list and the page take one case each through it.
describe("issue 263 — groupByMember", () => {
  const ROSA = "member-rosa";
  const CHIDI = "member-chidi";
  const rosas = (over: Partial<Subscriber>) => row({ memberId: ROSA, ...over });
  const ids = (rows: Subscriber[]) => rows.map((r) => r.subscriptionId);
  /** The one person `memberId` groups to. */
  const groupOf = (rows: Subscriber[], memberId: string = ROSA): MemberRow | undefined => {
    const found = groupByMember(rows).filter((group) => group.memberId === memberId);
    expect(found).toHaveLength(1);
    return found[0];
  };

  it("AC1: a member's subscriptions come back as one row, and each other member as a row of their own", () => {
    const first = rosas({ status: "cancelled", joinedDate: "2026-11-02" });
    const chidi = row({ memberId: CHIDI, firstName: "Chidi", lastName: "Abara" });
    const again = rosas({ joinedDate: "2026-11-20" });

    const groups = groupByMember([first, chidi, again]);

    expect(groups.map((group) => group.memberId).sort()).toEqual([CHIDI, ROSA]);
    const rosa = groups.find((group) => group.memberId === ROSA);
    expect(ids([rosa?.current, ...(rosa?.earlier ?? [])].filter((r): r is Subscriber => r !== undefined)).sort()).toEqual(ids([first, again]).sort());
  });

  it("AC3: a member with one subscription is a row whose current is it and whose earlier is empty", () => {
    const only = rosas({});
    expect(groupByMember([only])).toEqual([{ memberId: ROSA, current: only, earlier: [] }]);
  });

  it.each([
    ["listed first", "first"],
    ["listed last", "last"],
  ])("AC2: an active subscription is current over a cancelled one joined later, the active one %s", (_what, where) => {
    const active = rosas({ status: "active", joinedDate: "2026-11-01" });
    const cancelled = rosas({ status: "cancelled", joinedDate: "2026-11-20" });
    const group = groupOf(where === "first" ? [active, cancelled] : [cancelled, active]);
    expect(group?.current.subscriptionId).toBe(active.subscriptionId);
    expect(ids(group?.earlier ?? [])).toEqual([cancelled.subscriptionId]);
  });

  it.each([
    ["listed first", "first"],
    ["listed last", "last"],
  ])("AC2: an active subscription is current over a cancelled one joined the same day, the active one %s", (_what, where) => {
    const active = rosas({ status: "active", joinedDate: "2026-11-23" });
    const cancelled = rosas({ status: "cancelled", joinedDate: "2026-11-23" });
    expect(groupOf(where === "first" ? [active, cancelled] : [cancelled, active])?.current.subscriptionId).toBe(active.subscriptionId);
  });

  it.each([
    ["listed first", "first"],
    ["listed last", "last"],
  ])("AC2: of two cancelled, the one joined later is current, %s", (_what, where) => {
    const older = rosas({ status: "cancelled", joinedDate: "2026-11-02" });
    const newer = rosas({ status: "cancelled", joinedDate: "2026-11-20" });
    expect(groupOf(where === "first" ? [newer, older] : [older, newer])?.current.subscriptionId).toBe(newer.subscriptionId);
  });

  it("AC2: of two cancelled joined the same day, the later in listSubscribers' order is current, whichever way round they come", () => {
    const a = rosas({ status: "cancelled", joinedDate: "2026-11-23" });
    const b = rosas({ status: "cancelled", joinedDate: "2026-11-23" });
    expect(groupOf([a, b])?.current.subscriptionId).toBe(b.subscriptionId);
    expect(groupOf([b, a])?.current.subscriptionId).toBe(a.subscriptionId);
  });

  it("AC3: earlier is newest first by the same rule: the newer joined date first, a same-day tie to the later in the list", () => {
    const current = rosas({ status: "active", joinedDate: "2026-11-25" });
    const oldest = rosas({ status: "cancelled", joinedDate: "2026-11-01" });
    const sameDayFirst = rosas({ status: "cancelled", joinedDate: "2026-11-10" });
    const sameDayLater = rosas({ status: "cancelled", joinedDate: "2026-11-10" });

    const group = groupOf([sameDayFirst, oldest, current, sameDayLater]);

    expect(group?.current.subscriptionId).toBe(current.subscriptionId);
    expect(ids(group?.earlier ?? [])).toEqual(ids([sameDayLater, sameDayFirst, oldest]));
  });
});

describe("AC5 (issue 263) — search over people", () => {
  it("AC5: a person with earlier subscriptions is found once, as their one row", () => {
    const current = row({ memberId: "member-rosa", joinedDate: "2026-11-20" });
    const earlier = row({ memberId: "member-rosa", status: "cancelled", joinedDate: "2026-11-02" });
    const rosa = person(current, earlier);
    const chidi = person(row({ firstName: "Chidi", lastName: "Abara", email: "chidi@example.com", phone: "(440) 555-0133" }));

    expect(filterMembers([rosa, chidi], "bennett")).toEqual([rosa]);
  });

  it("AC5: it matches on the current subscription's details, not an earlier one's", () => {
    const rosa = person(row({ email: "rosa.now@example.com" }), row({ email: "rosa.then@example.com", status: "cancelled" }));

    expect(filterMembers([rosa], "rosa.now")).toEqual([rosa]);
    expect(filterMembers([rosa], "rosa.then")).toEqual([]);
  });
});

describe("AC6 (issue 263) — sort over people", () => {
  const sorted = (rows: MemberRow[], key: SortKey, direction: Sort["direction"]) => named(sortMembers(rows, { key, direction }));

  it("AC6: by status, a person whose current subscription is active sorts with the active, before every cancelled person, whatever their earlier ones", () => {
    const rejoined = person(row({ lastName: "Castillo", firstName: "Marco" }), row({ lastName: "Castillo", firstName: "Marco", status: "cancelled" }));
    const gone = person(row({ lastName: "Abara", firstName: "Chidi", status: "cancelled" }));
    const active = person(row({ lastName: "Bennett", firstName: "Rosa" }));

    expect(sorted([gone, rejoined, active], "status", "asc")).toEqual(["Bennett, Rosa", "Castillo, Marco", "Abara, Chidi"]);
  });

  it("AC6: by joined, a person sorts on their current subscription's date, not an earlier one's", () => {
    const rejoined = person(row({ lastName: "Abara", firstName: "Chidi", joinedDate: "2026-12-10" }), row({ lastName: "Abara", firstName: "Chidi", status: "cancelled", joinedDate: "2026-11-01" }));
    const single = person(row({ lastName: "Bennett", firstName: "Rosa", joinedDate: "2026-12-05" }));

    expect(sorted([rejoined, single], "joined", "asc")).toEqual(["Bennett, Rosa", "Abara, Chidi"]);
  });

  it("AC6: by meal, a person sorts on their current subscription's meal", () => {
    const switched = person(row({ lastName: "Abara", firstName: "Chidi", options: meal("3–4 people", "Vegan") }), row({ lastName: "Abara", firstName: "Chidi", status: "cancelled", options: meal("2 people", "Standard") }));
    const single = person(row({ lastName: "Bennett", firstName: "Rosa", options: meal("2 people", "Vegan") }));

    expect(sorted([switched, single], "meal", "asc")).toEqual(["Bennett, Rosa", "Abara, Chidi"]);
  });
});
