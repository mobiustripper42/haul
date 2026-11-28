// Issue 263, AC7 and AC8: the never-subscribed card, `NeverSubscribedList` rendered through react-dom/server with the rows
// it is given and a stand-in for the words the page translates, so what is read is the card's own markup. Who is in the
// rows, and their order, is listUnsubscribedMembers' (src/adapters/signup-contract.ts); what the page gives the card is
// app/admin/page.test.ts's. `Badge` is the real one wrapped in a spy, so the markup is what it writes and the spy records
// the kind it was given.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnsubscribedMember } from "@core/ports/repository.js";
import { Card } from "../../components/ui/card";
import { fill } from "../fill";
import { findAll, textsOf } from "../screen-test-helpers";
import { NeverSubscribedList, type NeverSubscribedText } from "./never-subscribed-list";

/** The props each Badge was rendered with, in order. */
const badges = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../../components/ui/badge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/ui/badge")>();
  const { createElement: create } = await import("react");
  return {
    ...actual,
    Badge: function SpiedBadge(props: Parameters<typeof actual.Badge>[0]) {
      badges.push(props);
      return create(actual.Badge, props);
    },
  };
});

beforeEach(() => {
  badges.length = 0;
});

const TEXT: NeverSubscribedText = {
  title: "Not yet in",
  intro: "Accounts with no meal",
  empty: "All in",
  columns: { name: "Who", email: "Mail", phone: "Ring", accountMade: "Since" },
  notConfirmed: "Unchecked",
  accountMadeLine: "Here since {date}",
};

let made = 0;
const member = (over: Partial<UnsubscribedMember> = {}): UnsubscribedMember => ({
  memberId: `member-${++made}`,
  firstName: "Rosa",
  lastName: "Bennett",
  email: "rosa@example.com",
  phone: "2165550187",
  createdDate: "2026-11-23",
  confirmed: true,
  ...over,
});

const ROSA = member();
const CHIDI = member({ firstName: "Chidi", lastName: "Abara", email: "chidi@example.com", phone: "4405550123", createdDate: "2026-11-02" });
const LINH = member({ firstName: "Linh", lastName: "Dang", email: "linh@example.com", phone: "2165550166", createdDate: "2026-10-30", confirmed: false });

const props = (rows: UnsubscribedMember[]) => ({ rows, text: TEXT, language: "en" as const });
const render = (rows: UnsubscribedMember[]) => renderToStaticMarkup(createElement(NeverSubscribedList, props(rows)));

/** The cells of each table body row, each as its text. */
const tableRows = (html: string): string[][] => {
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row = ""]) =>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, cell = ""]) => textsOf(cell).join(" ")),
  );
};

/** The stacked rows' items, each as its runs of text. */
const stackedRows = (html: string): string[][] => [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, inner = ""]) => textsOf(inner));

describe("AC7 — the never-subscribed card's rows", () => {
  it("AC7: each table row is the name, the email, the phone and the date the account was made, in the order given", () => {
    expect(tableRows(render([ROSA, CHIDI]))).toEqual([
      ["Bennett, Rosa", "rosa@example.com", "(216) 555-0187", "Nov 23"],
      ["Abara, Chidi", "chidi@example.com", "(440) 555-0123", "Nov 2"],
    ]);
  });

  it("AC7: a member with no name and no phone has empty cells, not the word null", () => {
    expect(tableRows(render([member({ firstName: null, lastName: null, phone: null, email: "ada@example.com" })]))).toEqual([["", "ada@example.com", "", "Nov 23"]]);
  });

  it("AC7: each stacked row is the name, then the account line with its date, then the email and phone, in the order given", () => {
    expect(stackedRows(render([ROSA, CHIDI]))).toEqual([
      ["Bennett, Rosa", fill(TEXT.accountMadeLine, { date: "Nov 23" }), "rosa@example.com · (216) 555-0187"],
      ["Abara, Chidi", fill(TEXT.accountMadeLine, { date: "Nov 2" }), "chidi@example.com · (440) 555-0123"],
    ]);
  });

  it("AC7: an unconfirmed member carries the unconfirmed badge, after the email in the table and beside the name on the stacked row; a confirmed one carries none", () => {
    const html = render([ROSA, LINH]);
    expect(tableRows(html).map((row) => row[1])).toEqual(["rosa@example.com", `linh@example.com ${TEXT.notConfirmed}`]);
    expect(stackedRows(html).map((row) => row.slice(0, 2))).toEqual([
      ["Bennett, Rosa", fill(TEXT.accountMadeLine, { date: "Nov 23" })],
      ["Dang, Linh", TEXT.notConfirmed],
    ]);
    expect(badges.map((badge) => ({ kind: badge.kind, children: badge.children }))).toEqual([
      { kind: "unconfirmed", children: TEXT.notConfirmed },
      { kind: "unconfirmed", children: TEXT.notConfirmed },
    ]);
  });

  it("AC7, AC8: with rows, the card holds no empty line", () => {
    expect(textsOf(render([ROSA]))).not.toContain(TEXT.empty);
  });
});

describe("AC8 — the never-subscribed card with nobody in it", () => {
  it("AC8: it has no rows, in the table or stacked, and the empty line in their place", () => {
    const html = render([]);
    expect(tableRows(html)).toEqual([]);
    expect(stackedRows(html)).toEqual([]);
    expect(textsOf(html)).toContain(TEXT.empty);
  });

  it("AC8: the card stays: it is drawn in its Card, with or without rows", () => {
    expect(findAll(NeverSubscribedList(props([])), Card)).toHaveLength(1);
    expect(findAll(NeverSubscribedList(props([ROSA])), Card)).toHaveLength(1);
  });
});
