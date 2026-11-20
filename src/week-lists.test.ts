// Issue 142: a week's meals and skips turned into the pick list, its CSV, the skips CSV, the printed pickup rows
// and the closing line's names. Which subscriptions are meals and skips is the repository's (AC1,
// src/adapters/week-lists-contract.ts). The CSVs are read back through a CSV parser, so a test sees what a
// spreadsheet would; the cell rules' own cases are the member spreadsheet's (src/member-export.test.ts), one of each
// here. Name order and "Last, First" are owned here, by `pickupRows` and `weekSummary`; the print page only renders them.
import { describe, expect, it } from "vitest";
import { parseCsv } from "./member-export-test-helpers.js";
import type { WeekBox, WeekMember } from "./ports/repository.js";
import type { ProductOptionType, ProductWithOptions } from "./products.js";
import { pickList, pickListCsv, pickupRows, skipsCsv, weekSummary, type PickList } from "./week-lists.js";

const SIZES: ProductOptionType = {
  id: "type-sizes",
  name: "How many people",
  position: 1,
  options: [
    { id: "for-4", name: "Portioned for 4", priceCents: 7400, position: 1 },
    { id: "for-2", name: "Portioned for 2", priceCents: 4200, position: 2 },
  ],
};

const MENUS: ProductOptionType = {
  id: "type-menus",
  name: "Which menu",
  position: 2,
  options: [
    { id: "standard", name: "Standard", priceCents: 0, position: 1 },
    { id: "vegan", name: "Vegan", priceCents: 0, position: 2 },
  ],
};

const product = (optionTypes: ProductOptionType[] = [SIZES, MENUS]): ProductWithOptions => ({
  id: "product",
  name: "Supper Club",
  cap: 50,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes,
});

let serial = 0;

/** A skip: a member picking `size` and `menu`, in that order. */
const member = (over: Partial<WeekMember> = {}, size = "Portioned for 4", menu = "Standard"): WeekMember => ({
  subscriptionId: `subscription-${++serial}`,
  firstName: "Rosa",
  lastName: "Bennett",
  email: "rosa@example.com",
  phone: "216-555-0187",
  options: [
    { typeName: "How many people", optionName: size },
    { typeName: "Which menu", optionName: menu },
  ],
  ...over,
});

/** A meal: no week credit and no declined card unless `over` says so. */
const box = (size: string, menu: string, over: Partial<WeekBox> = {}): WeekBox => ({ ...member({}, size, menu), weekCredit: false, cardDeclined: false, ...over });

describe("AC2 — pickList", () => {
  it("AC2: one row per combination, the first option type outermost and each type's options in position order, zeros included, and the total", () => {
    const boxes = [box("Portioned for 4", "Standard"), box("Portioned for 2", "Vegan"), box("Portioned for 4", "Standard")];
    expect(pickList(product(), boxes)).toEqual({
      rows: [
        { options: ["Portioned for 4", "Standard"], boxes: 2 },
        { options: ["Portioned for 4", "Vegan"], boxes: 0 },
        { options: ["Portioned for 2", "Standard"], boxes: 0 },
        { options: ["Portioned for 2", "Vegan"], boxes: 1 },
      ],
      total: 3,
    });
  });

  it("AC2: the outermost type is the one with the lowest position, whichever it is", () => {
    const menuFirst = product([
      { ...MENUS, position: 1 },
      { ...SIZES, position: 2 },
    ]);
    const vegan2: WeekBox = {
      ...box("Portioned for 2", "Vegan"),
      options: [
        { typeName: "Which menu", optionName: "Vegan" },
        { typeName: "How many people", optionName: "Portioned for 2" },
      ],
    };
    expect(pickList(menuFirst, [vegan2]).rows).toEqual([
      { options: ["Standard", "Portioned for 4"], boxes: 0 },
      { options: ["Standard", "Portioned for 2"], boxes: 0 },
      { options: ["Vegan", "Portioned for 4"], boxes: 0 },
      { options: ["Vegan", "Portioned for 2"], boxes: 1 },
    ]);
  });

  it("AC2: with no meals every combination is a row at 0, and the total is 0", () => {
    expect(pickList(product(), [])).toEqual({
      rows: [
        { options: ["Portioned for 4", "Standard"], boxes: 0 },
        { options: ["Portioned for 4", "Vegan"], boxes: 0 },
        { options: ["Portioned for 2", "Standard"], boxes: 0 },
        { options: ["Portioned for 2", "Vegan"], boxes: 0 },
      ],
      total: 0,
    });
  });

  it("AC2: a meal whose card was declined and one a week credit paid are counted like any other", () => {
    const boxes = [box("Portioned for 2", "Standard", { cardDeclined: true }), box("Portioned for 2", "Standard", { weekCredit: true })];
    const list = pickList(product(), boxes);
    expect(list.rows.find((row) => row.options.join() === "Portioned for 2,Standard")?.boxes).toBe(2);
    expect(list.total).toBe(2);
  });
});

describe("AC5 — pickListCsv", () => {
  const LIST: PickList = {
    rows: [
      { options: ["Portioned for 4", "Standard"], boxes: 5 },
      { options: ["Portioned for 4", "Vegan"], boxes: 0 },
      { options: ["Portioned for 2", "Standard"], boxes: 3 },
      { options: ["Portioned for 2", "Vegan"], boxes: 1 },
    ],
    total: 9,
  };

  it('AC5: the option types\' names and "Meals" as the header, one row per combination, and a last row "Meals to make" with the total under Meals, the other cells empty', () => {
    expect(parseCsv(pickListCsv(product(), LIST))).toEqual([
      ["How many people", "Which menu", "Meals"],
      ["Portioned for 4", "Standard", "5"],
      ["Portioned for 4", "Vegan", "0"],
      ["Portioned for 2", "Standard", "3"],
      ["Portioned for 2", "Vegan", "1"],
      ["Meals to make", "", "9"],
    ]);
  });

  it("AC5: each record ends in CRLF", () => {
    const text = pickListCsv(product(), LIST);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.split("\r\n")).toHaveLength(7);
    expect(text.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  });

  it("AC5: cells are neutralised as the member spreadsheet's are: a formula start gets an apostrophe, an ordinary cell stays as typed", () => {
    const named = product([{ ...SIZES, name: "=People" }, MENUS]);
    const list: PickList = { rows: [{ options: ["+4", "Standard"], boxes: 1 }], total: 1 };
    expect(parseCsv(pickListCsv(named, list))).toEqual([
      ["'=People", "Which menu", "Meals"],
      ["'+4", "Standard", "1"],
      ["Meals to make", "", "1"],
    ]);
  });
});

describe("AC6 — skipsCsv", () => {
  const TYPES = ["How many people", "Which menu"];
  const HEADER = ["Last name", "First name", "Email", "Phone", ...TYPES];

  it("AC6: Last name, First name, Email, Phone, one column per option type, and nothing after", () => {
    expect(parseCsv(skipsCsv(TYPES, [member({}, "Portioned for 2", "Vegan")]))).toEqual([
      HEADER,
      ["Bennett", "Rosa", "rosa@example.com", "216-555-0187", "Portioned for 2", "Vegan"],
    ]);
  });

  it("AC6 [Lead]: in name order, last name then first, whatever order the skips arrive in", () => {
    const skips = [
      member({ lastName: "Nguyen", firstName: "Tam", email: "tam@example.com" }),
      member({ lastName: "abara", firstName: "Chidi", email: "chidi@example.com" }),
      member({ lastName: "Nguyen", firstName: "Lan", email: "lan@example.com" }),
    ];
    expect(parseCsv(skipsCsv(TYPES, skips)).slice(1).map((record) => record[2])).toEqual(["chidi@example.com", "lan@example.com", "tam@example.com"]);
  });

  it("AC6 [code]: a phone of digits, spaces and + - ( ) . is written as typed, while a formula start elsewhere is neutralised", () => {
    const [, row] = parseCsv(skipsCsv(TYPES, [member({ lastName: "=cmd", phone: "+1 (216) 555-0142" })]));
    expect(row?.[0]).toBe("'=cmd");
    expect(row?.[3]).toBe("+1 (216) 555-0142");
  });

  it("AC5 (issue 222): the Phone cell is memberCells': a stored 2165551234 is written (216) 555-1234", () => {
    const [, row] = parseCsv(skipsCsv(TYPES, [member({ phone: "2165551234" })]));
    expect(row?.[3]).toBe("(216) 555-1234");
  });

  it("AC6: with no skips the file is the header row", () => {
    expect(parseCsv(skipsCsv(TYPES, []))).toEqual([HEADER]);
  });
});

describe("AC7 — pickupRows", () => {
  it("AC7: in name order, last name then first and case-insensitive, whatever order the meals arrive in", () => {
    const boxes = [
      box("Portioned for 4", "Standard", { lastName: "Nguyen", firstName: "Tam" }),
      box("Portioned for 4", "Standard", { lastName: "abara", firstName: "Chidi" }),
      box("Portioned for 4", "Standard", { lastName: "Nguyen", firstName: "Lan" }),
    ];
    expect(pickupRows(boxes).map((row) => row.name)).toEqual(["abara, Chidi", "Nguyen, Lan", "Nguyen, Tam"]);
  });

  it('AC7: each row is the name as "Last, First", the meal as its option names joined by " · ", and the note cardDeclined or null', () => {
    const boxes = [
      box("Portioned for 2", "Vegan", { lastName: "Castillo", firstName: "Marco", cardDeclined: true }),
      box("Portioned for 4", "Standard", { lastName: "Bennett", firstName: "Rosa", weekCredit: true }),
    ];
    expect(pickupRows(boxes)).toEqual([
      { name: "Bennett, Rosa", box: "Portioned for 4 · Standard", note: null },
      { name: "Castillo, Marco", box: "Portioned for 2 · Vegan", note: "cardDeclined" },
    ]);
  });
});

describe("AC4, AC7 — weekSummary", () => {
  it('AC7 [Lead]: skipped is the skips\' names and weekCredit the names of the meals a week credit paid, each "Last, First" in name order', () => {
    const boxes = [
      box("Portioned for 4", "Standard", { lastName: "Okafor", firstName: "Ada", weekCredit: true }),
      box("Portioned for 4", "Standard", { lastName: "Bennett", firstName: "Rosa" }),
      box("Portioned for 2", "Vegan", { lastName: "Castillo", firstName: "Marco", weekCredit: true }),
    ];
    const skips = [member({ lastName: "Nguyen", firstName: "Tam" }), member({ lastName: "Abara", firstName: "Chidi" })];
    expect(weekSummary({ boxes, skips })).toEqual({ skipped: ["Abara, Chidi", "Nguyen, Tam"], weekCredit: ["Castillo, Marco", "Okafor, Ada"], members: 5 });
  });

  it("AC4 [Lead]: a member holding two subscriptions that both skip is named twice (DEC-026)", () => {
    const skips = [member({ lastName: "Nguyen", firstName: "Lan" }), member({ lastName: "Nguyen", firstName: "Lan" })];
    expect(weekSummary({ boxes: [], skips }).skipped).toEqual(["Nguyen, Lan", "Nguyen, Lan"]);
  });
});

// Issue 183: the week's member count has one home, here; Weekly lists only renders it (app/admin/lists/page.test.ts).
// Who is in the week is `listWeekBoxes`'s rule (src/adapters/week-lists-contract.ts), so these count what they are given.
describe("issue 183, AC1 — weekSummary's members", () => {
  it("AC1: members is the week's meals plus its skips: 11 meals and 1 skip read 12", () => {
    const boxes = Array.from({ length: 11 }, (_, at) => box(at % 2 ? "Portioned for 2" : "Portioned for 4", at % 3 ? "Standard" : "Vegan", { weekCredit: at === 0 }));
    const skips = [member({ lastName: "Nguyen", firstName: "Lan" })];
    expect(weekSummary({ boxes, skips }).members).toBe(12);
  });

  it("AC1 [Lead]: one per subscription: a member holding two subscriptions in the week, one a meal and one a skip, counts twice", () => {
    const lan = { lastName: "Nguyen", firstName: "Lan", email: "lan@example.com" };
    expect(weekSummary({ boxes: [box("Portioned for 2", "Standard", lan)], skips: [member(lan)] }).members).toBe(2);
  });
});
