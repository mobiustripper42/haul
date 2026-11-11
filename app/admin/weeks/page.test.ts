// Issue 149: the weeks screen, rendered through react-dom/server with `next/headers` faked and the composition
// root mocked, as app/admin/page.test.ts renders /admin. Read as the markup and its text, not the tree, so a
// row or a dialog may be its own component. Which weeks are listed, and their cutoffs, are
// src/pickup-week-calendar.test.ts's; what the actions write is ./actions.test.ts's. The wording is new copy,
// typed here once (src/messages/en.ts gains it with this task); who may see the page is app/admin/admin-guard.test.ts's.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { ChangedWeek } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../../next-headers-fake";
import { attributesOf, escapeRegExp, screenMarkup } from "../../screen-test-helpers";
import { SiteHeader } from "../../site-header";
import { addSupperClub } from "../subscribers-fixture";
import AdminWeeks from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("/admin/weeks has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

// Wednesday, February 3, noon in Cleveland. The list starts at the week of February 7, past its cutoff (the end
// of Monday, February 1) with its pickup to come; February 14's cutoff is the end of Monday, February 8.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const PAST_CUTOFF = "2027-02-07";
const OPEN = "2027-02-14";
const BEFORE_FEB_14_CUTOFF = new Date("2027-02-02T15:00:00.000Z");
const DAY = 24 * 60 * 60_000;

const TITLE_FEB_7 = "February 7 and 8";
const TITLE_FEB_14 = "February 14 and 15";
const TITLE_FEB_21 = "February 21 and 22";

const HINT =
  "The next 12 weeks. Close a week when there is no pickup, or move its pickup days. Closing before the cutoff skips that week's charge, and members who paid for it at signup get a week credit. Closing after the cutoff gives everyone who paid a week credit: their next meal is made and not charged.";

let product: ProductWithOptions;
let members = 0;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.mocked(SiteHeader).mockClear();
  product = addSupperClub(services.repo);
  const admin = await services.repo.createMember({ email: "lenny@example.com", role: "admin" });
  request.current.cookies.ocf_session = signSession({ subjectId: admin.id, expiresAt: new Date(NOW.getTime() + DAY).toISOString() }, services.secret);
});

afterEach(() => {
  vi.useRealTimers();
});

/** `n` new members' signups for `week`, each charged at signup. */
const paidFor = async (week: string, n: number): Promise<void> => {
  for (let i = 0; i < n; i++) {
    const member = await services.repo.createMember({ email: `member-${++members}@example.com` });
    const signup = await services.repo.savePendingSignup({
      memberId: member.id,
      productId: product.id,
      choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
      firstChargeCents: 8000,
      weeklyCents: 8000,
      pickupDate: week,
      consentText: "I agree to a weekly charge of $80.",
      consentAt: new Date("2027-01-20T15:00:00.000Z"),
    });
    await services.repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, new Date("2027-01-20T15:00:05.000Z"));
  }
};

const save = (weekOf: string, over: Partial<ChangedWeek>) =>
  services.repo.savePickupWeek(product.id, { weekOf, closedAt: null, note: null, firstDay: null, lastDay: null, ...over });

// Tags become a mark, so a whole element's text can be found as a run, and dropped, so a sentence split by inline
// markup still reads as one.
const MARK = "\u0001";
const marked = (html: string): string => screenMarkup(html).replace(/<[^>]*>/g, MARK);
const runsOf = (markedText: string): string[] =>
  markedText
    .split(MARK)
    .map((run) => run.trim())
    .filter((run) => run !== "");

type Screen = { html: string; text: string; runs: string[] };

const screenOf = (html: string): Screen => {
  const m = marked(html);
  return { html, text: m.split(MARK).join(""), runs: runsOf(m) };
};

/** The page for `query`, as markup, its text, and its runs of text. */
const render = async (query: Record<string, string> = {}): Promise<Screen> =>
  screenOf(renderToStaticMarkup(await AdminWeeks({ searchParams: Promise.resolve(query) })));

/** Where `run` is a whole element's text in `m`, from `from` on; -1 when it is not. */
const runAt = (m: string, run: string, from = 0): number => {
  const found = new RegExp(`${MARK}\\s*${escapeRegExp(run)}\\s*${MARK}`, "g");
  found.lastIndex = from;
  return found.exec(m)?.index ?? -1;
};

/**
 * One row: from the element whose whole text is `title` to the one whose whole text is `next` — a dialog's heading
 * names a week too, but is not the title alone. `from` may also be the hint, for the first row.
 */
const rowOf = (screen: Screen, title: string, next: string): Screen => {
  const m = marked(screen.html);
  const start = runAt(m, title);
  const end = start === -1 ? -1 : runAt(m, next, start + 1);
  const slice = start === -1 ? "" : m.slice(start, end === -1 ? undefined : end);
  return { html: "", text: slice.split(MARK).join(""), runs: runsOf(slice) };
};

/** Of `wanted`, those found one after another in `text`, so a test can say "A, then B, then C". */
const inSequence = (text: string, wanted: readonly string[]): string[] => {
  const found: string[] = [];
  let from = 0;
  for (const item of wanted) {
    const at = text.indexOf(item, from);
    if (at === -1) continue;
    found.push(item);
    from = at + item.length;
  }
  return found;
};

/** What each link or button labelled `label` asks for: a link's query, or a GET button's name and value. */
const targets = (html: string, label: string): Record<string, string>[] => {
  const markup = screenMarkup(html);
  const textOf = (inner: string) => inner.replace(/<[^>]*>/g, "").trim();
  const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
  const links = [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter(([, , inner = ""]) => textOf(inner) === label)
    .map(([, attrs = ""]) => Object.fromEntries(new URL(attr(attrs, "href") ?? "", "http://haul.test/admin/weeks").searchParams));
  const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, attrs = "", inner = ""]) => textOf(inner) === label && attr(attrs, "name") !== undefined)
    .map(([, attrs = ""]) => ({ [attr(attrs, "name") ?? ""]: attr(attrs, "value") ?? "" }));
  return [...links, ...buttons];
};

/** The named form controls on the page, `name` → `value` (a textarea's is its text), inputs and buttons alike. */
const controls = (html: string): Array<{ tag: string; name: string; value: string; type?: string }> => {
  const markup = screenMarkup(html);
  const fields = (["input", "button"] as const).flatMap((tag) =>
    attributesOf(html, tag)
      .filter((a) => a.name !== undefined)
      .map((a) => ({ tag, name: a.name ?? "", value: a.value ?? "", ...(a.type === undefined ? {} : { type: a.type }) })),
  );
  const areas = [...markup.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)].map(([, attrs = "", inner = ""]) => ({
    tag: "textarea",
    name: /\bname="([^"]*)"/.exec(attrs)?.[1] ?? "",
    value: inner,
  }));
  return [...fields, ...areas];
};

const hasControl = (html: string, name: string, value?: string) =>
  controls(html).some((control) => control.name === name && (value === undefined || control.value === value));

describe("AC1 — the weeks", () => {
  it("AC1: 12 rows in date order from the earliest week whose pickup is not over, each with its cutoff", async () => {
    const { text } = await render();
    const cutoffs = [...text.matchAll(/Cutoff(?: passed)?: end of (\w+day, \w+ \d+)/g)].map(([, date]) => date);
    expect(cutoffs).toEqual([
      "Monday, February 1",
      "Monday, February 8",
      "Monday, February 15",
      "Monday, February 22",
      "Monday, March 1",
      "Monday, March 8",
      "Monday, March 15",
      "Monday, March 22",
      "Monday, March 29",
      "Monday, April 5",
      "Monday, April 12",
      "Monday, April 19",
    ]);
  });

  it("AC1: each row is titled with its pickup days", async () => {
    const { runs } = await render();
    expect(runs.filter((run) => [TITLE_FEB_7, TITLE_FEB_14, TITLE_FEB_21].includes(run))).toEqual([TITLE_FEB_7, TITLE_FEB_14, TITLE_FEB_21]);
  });
});

describe("AC14 — the screen in order", () => {
  it("AC14: the header, then Members and Weeks, then the Weeks heading and its hint, then the weeks", async () => {
    const { text } = await render();
    const wanted = ["the header", "Members", "Weeks", "Weeks", HINT, TITLE_FEB_7];
    expect(inSequence(text, wanted)).toEqual(wanted);
  });

  it('AC14: the header is asked for with current "admin"', async () => {
    await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "admin" }));
  });

  it("AC14: Members links to /admin and Weeks to /admin/weeks, marked as the page showing", async () => {
    const markup = screenMarkup((await render()).html);
    const links = [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
      text: inner.replace(/<[^>]*>/g, "").trim(),
      href: /\bhref="([^"]*)"/.exec(attrs)?.[1],
      current: /\baria-current="page"/.test(attrs),
    }));
    expect(links).toContainEqual({ text: "Members", href: "/admin", current: false });
    expect(links).toContainEqual({ text: "Weeks", href: "/admin/weeks", current: true });
  });

  it('AC14: "Weeks" is the page\'s one level-1 heading, and the weeks are labelled "Upcoming weeks" after the hint', async () => {
    const { html } = await render();
    const markup = screenMarkup(html);
    expect([...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(([, inner = ""]) => inner.replace(/<[^>]*>/g, "").trim())).toEqual(["Weeks"]);
    const label = markup.indexOf("Upcoming weeks");
    expect(label).toBeGreaterThan(markup.indexOf("The next 12 weeks."));
    expect(label).toBeLessThan(markup.indexOf(TITLE_FEB_7));
  });
});

describe("AC2, AC3, AC14 — the close dialog", () => {
  it("AC2, AC14: ?close on a week nobody has paid for: the dialog, after the hint and before the weeks, in its order", async () => {
    const { text } = await render({ close: OPEN });
    const wanted = [
      HINT,
      "Close the week of February 14 and 15?",
      "Nobody has been charged for it. The charge at the end of Monday, February 8 is skipped, and members see the week as closed.",
      "Note for admins (optional)",
      "Shown on this row. Members never see it.",
      "Close the week",
      "Keep it open",
      TITLE_FEB_7,
    ];
    expect(inSequence(text, wanted)).toEqual(wanted);
  });

  it("AC2: the dialog's heading is a level-2 heading", async () => {
    const markup = screenMarkup((await render({ close: OPEN })).html);
    expect([...markup.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map(([, inner = ""]) => inner.replace(/<[^>]*>/g, "").trim())).toContain(
      "Close the week of February 14 and 15?",
    );
  });

  it("AC2: the dialog's form sends the week and a note", async () => {
    const { html } = await render({ close: OPEN });
    expect(hasControl(html, "week", OPEN)).toBe(true);
    expect(controls(html)).toContainEqual(expect.objectContaining({ tag: "textarea", name: "note" }));
  });

  it("AC3, AC14: before the cutoff with 3 paid at signup: who paid, and the button gives 3 week credits", async () => {
    await paidFor(OPEN, 3);
    const { text } = await render({ close: OPEN });
    expect(text).toContain(
      "3 members paid for this week when they signed up. Each gets a week credit: their next meal is made and not charged. Nobody else is charged: the charge at the end of Monday, February 8 is skipped, and members see the week as closed.",
    );
    expect(text).toContain("Close the week and give 3 week credits");
    expect(text).not.toContain("Nobody has been charged for it.");
  });

  it("AC3, AC14: before the cutoff with 1 paid: the singular", async () => {
    await paidFor(OPEN, 1);
    const { text } = await render({ close: OPEN });
    expect(text).toContain("1 member paid for this week when they signed up.");
    expect(text).toContain("Close the week and give 1 week credit");
    expect(text).not.toContain("1 week credits");
  });

  it("AC3, AC14: after the cutoff: who was charged and when, that it cannot be undone, and the button gives week credits", async () => {
    await paidFor(PAST_CUTOFF, 2);
    const { text } = await render({ close: PAST_CUTOFF });
    const wanted = [
      "Close the week of February 7 and 8?",
      "2 members were charged for it at the end of Monday, February 1. Each gets a week credit: their next meal is made and not charged. This cannot be undone.",
      "Close the week and give week credits",
      "Keep it open",
    ];
    expect(inSequence(text, wanted)).toEqual(wanted);
  });

  it("AC3, AC14: after the cutoff with 1 charged: the singular", async () => {
    await paidFor(PAST_CUTOFF, 1);
    const { text } = await render({ close: PAST_CUTOFF });
    expect(text).toContain("1 member was charged for it at the end of Monday, February 1.");
  });
});

describe("AC7, AC14 — the reopen dialog", () => {
  it("AC7, AC14: ?reopen on a week whose closing gave 2 week credits says they are taken back, in its order", async () => {
    await paidFor(OPEN, 2);
    await services.repo.closePickupWeek(product.id, OPEN, null, BEFORE_FEB_14_CUTOFF);
    const { text, html } = await render({ reopen: OPEN });
    const wanted = [
      HINT,
      "Reopen the week of February 14 and 15?",
      "Closing it gave 2 members a week credit. Those week credits are taken back.",
      "Members are charged as usual at the end of Monday, February 8.",
      "Reopen the week",
      "Keep it closed",
      TITLE_FEB_7,
    ];
    expect(inSequence(text, wanted)).toEqual(wanted);
    expect(hasControl(html, "week", OPEN)).toBe(true);
  });

  it("AC7, AC14: ?reopen on a week whose closing gave none says so", async () => {
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF });
    const { text } = await render({ reopen: OPEN });
    expect(inSequence(text, ["Closing it gave no week credits.", "Members are charged as usual at the end of Monday, February 8."])).toEqual([
      "Closing it gave no week credits.",
      "Members are charged as usual at the end of Monday, February 8.",
    ]);
  });
});

describe("AC1, AC2, AC14 — an open row", () => {
  it("AC14: an open week's row has its cutoff, Move days and Close week, and no badge", async () => {
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    expect(row.text).toContain("Cutoff: end of Monday, February 8");
    expect(row.runs).toEqual(expect.arrayContaining(["Move days", "Close week"]));
    expect(row.runs).not.toEqual(expect.arrayContaining(["Closed"]));
    expect(row.runs).not.toEqual(expect.arrayContaining(["Moved"]));
    expect(row.text).not.toContain("Reopen");
    expect(row.text).not.toContain("Put back");
    expect(targets(screen.html, "Close week")).toContainEqual({ close: OPEN });
    expect(targets(screen.html, "Move days")).toContainEqual({ move: OPEN });
  });

  it("AC1, AC14: a week past its cutoff reads Cutoff passed, with how many were charged", async () => {
    await paidFor(PAST_CUTOFF, 2);
    const row = rowOf(await render(), TITLE_FEB_7, TITLE_FEB_14);
    expect(row.text).toContain("Cutoff passed: end of Monday, February 1 · 2 charged");
  });
});

describe("AC2, AC6–AC8, AC14 — a closed row", () => {
  it("AC2, AC7, AC14: closed before its cutoff: Closed and Note, its week credits, its note, Edit note and Reopen, and no move", async () => {
    await paidFor(OPEN, 2);
    await services.repo.closePickupWeek(product.id, OPEN, "Kitchen flooded", BEFORE_FEB_14_CUTOFF);
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    expect(row.runs).toEqual(expect.arrayContaining(["Closed", "Note", "Edit note", "Reopen"]));
    expect(row.text).toContain("2 week credits given at closing.");
    expect(row.text).toContain("Note: Kitchen flooded");
    for (const absent of ["Move days", "Put back", "Close week", "Add note"]) expect(row.text).not.toContain(absent);
    expect(targets(screen.html, "Reopen")).toContainEqual({ reopen: OPEN });
    expect(targets(screen.html, "Edit note")).toContainEqual({ note: OPEN });
  });

  it("AC6, AC14: a closed week with no note offers Add note, and its one week credit is singular", async () => {
    await paidFor(OPEN, 1);
    await services.repo.closePickupWeek(product.id, OPEN, null, BEFORE_FEB_14_CUTOFF);
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    expect(row.text).toContain("1 week credit given at closing.");
    expect(row.runs).toEqual(expect.arrayContaining(["Closed", "Add note"]));
    expect(row.runs).not.toEqual(expect.arrayContaining(["Note"]));
    expect(row.text).not.toContain("Edit note");
    expect(targets(screen.html, "Add note")).toContainEqual({ note: OPEN });
  });

  it("AC14: a closed week whose closing gave no week credit has no week-credit line", async () => {
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF });
    const row = rowOf(await render(), TITLE_FEB_14, TITLE_FEB_21);
    expect(row.runs).toEqual(expect.arrayContaining(["Closed"]));
    expect(row.text).not.toContain("given at closing");
  });

  it("AC8, AC14: closed after its cutoff: the closure stands, with its week credits, and no Reopen", async () => {
    await paidFor(PAST_CUTOFF, 2);
    await services.repo.closePickupWeek(product.id, PAST_CUTOFF, null, NOW);
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_7, TITLE_FEB_14);
    expect(row.runs).toEqual(expect.arrayContaining(["Closed"]));
    expect(row.text).toContain("Closed after its cutoff. 2 week credits given. The closure stands.");
    expect(row.text).not.toContain("given at closing");
    expect(row.text).not.toContain("Reopen");
    expect(targets(screen.html, "Reopen")).not.toContainEqual({ reopen: PAST_CUTOFF });
  });

  it("AC8: closed before its cutoff, which has since passed: no Reopen", async () => {
    await save(PAST_CUTOFF, { closedAt: new Date("2027-01-30T15:00:00.000Z") });
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_7, TITLE_FEB_14);
    expect(row.runs).toEqual(expect.arrayContaining(["Closed"]));
    expect(row.text).not.toContain("Closed after its cutoff");
    expect(row.text).not.toContain("Reopen");
  });

  it("AC11: a closed week that was moved shows no move: no Moved, no moved-from line, no Move days or Put back", async () => {
    await save(PAST_CUTOFF, { closedAt: new Date("2027-01-30T15:00:00.000Z"), firstDay: "2027-02-06", lastDay: "2027-02-07" });
    const screen = await render();
    // The first row runs from the hint to February 14's title, whatever a closed moved week is titled.
    const row = rowOf(screen, HINT, TITLE_FEB_14);
    expect(row.runs).toEqual(expect.arrayContaining(["Closed"]));
    expect(row.runs).not.toEqual(expect.arrayContaining(["Moved"]));
    for (const absent of ["Moved from", "Move days", "Put back"]) expect(row.text).not.toContain(absent);
  });
});

describe("AC9, AC10, AC14 — a moved row", () => {
  it("AC9, AC10, AC14: titled by its days, Moved, the days it moved from, the same cutoff, Move days, Put back and Close week", async () => {
    await save(OPEN, { firstDay: "2027-02-13", lastDay: "2027-02-14" });
    const screen = await render();
    const row = rowOf(screen, "Saturday, February 13 and Sunday, February 14", TITLE_FEB_21);
    expect(row.runs).toEqual(expect.arrayContaining(["Moved", "Move days", "Put back", "Close week"]));
    expect(row.text).toContain("Moved from Sunday and Monday, February 14 and 15");
    expect(row.text).toContain("Cutoff: end of Monday, February 8");
  });

  it("AC10: Put back sends the week to moveWeek with putBack", async () => {
    await save(OPEN, { firstDay: "2027-02-13", lastDay: "2027-02-14" });
    const { html } = await render();
    expect(hasControl(html, "putBack")).toBe(true);
    expect(hasControl(html, "week", OPEN)).toBe(true);
  });
});

describe("AC6, AC14 — the note panel", () => {
  it("AC6, AC14: ?note on a closed week with a note opens the panel in its row, in its order", async () => {
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF, note: "Kitchen flooded" });
    const screen = await render({ note: OPEN });
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    const wanted = ["Note for admins", "Members never see it.", "Save note", "Clear note", "Cancel"];
    expect(inSequence(row.text, wanted)).toEqual(wanted);
    expect(hasControl(screen.html, "week", OPEN)).toBe(true);
    expect(controls(screen.html)).toContainEqual(expect.objectContaining({ tag: "textarea", name: "note" }));
  });

  it("AC6: with no note there is nothing to clear: no Clear note", async () => {
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF });
    const row = rowOf(await render({ note: OPEN }), TITLE_FEB_14, TITLE_FEB_21);
    expect(row.text).toContain("Save note");
    expect(row.text).not.toContain("Clear note");
  });

  it("AC6: ?note on an open week opens nothing: an open week takes no note from the screen", async () => {
    const { text } = await render({ note: OPEN });
    expect(text).toContain("Cutoff: end of Monday, February 8");
    expect(text).not.toContain("Save note");
  });
});

describe("AC9, AC11, AC14 — the move panel", () => {
  it("AC9, AC14: ?move on an open week opens the panel in its row, in its order", async () => {
    const screen = await render({ move: OPEN });
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    const wanted = [
      "Move pickup days",
      "First day",
      "Last day",
      "For a one-day pickup, pick the same day as the first.",
      "The cutoff stays the end of Monday, February 8.",
      "Save days",
      "Cancel",
    ];
    expect(inSequence(row.text, wanted)).toEqual(wanted);
    expect(controls(screen.html)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "input", name: "firstDay", type: "date" }),
        expect.objectContaining({ tag: "input", name: "lastDay", type: "date" }),
      ]),
    );
    expect(hasControl(screen.html, "week", OPEN)).toBe(true);
  });

  it.each([
    ["beforeCutoff", "2027-02-08", "2027-02-14", "Pick a day after Monday, February 8. Pickup can't be on or before the cutoff date.", ["First day", "fault", "Last day"]],
    ["order", "2027-02-14", "2027-02-13", "The last day can't be before the first day.", ["First day", "Last day", "fault"]],
    [
      "overlapsNext",
      "2027-02-14",
      "2027-02-16",
      "Tuesday, February 16 runs into the next week's cutoff, the end of Monday, February 15. Pick a day on or before it.",
      ["First day", "Last day", "fault"],
    ],
  ])("AC9: error=%s shows its fault under the day at fault, with the dates entered back in the inputs", async (error, first, last, fault, order) => {
    const screen = await render({ move: OPEN, error, first, last });
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    const wanted = order.map((item) => (item === "fault" ? fault : item));
    expect(inSequence(row.text, wanted)).toEqual(wanted);
    expect(hasControl(screen.html, "firstDay", first)).toBe(true);
    expect(hasControl(screen.html, "lastDay", last)).toBe(true);
  });

  it("AC11: ?move on a closed week opens nothing", async () => {
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF });
    const row = rowOf(await render({ move: OPEN }), TITLE_FEB_14, TITLE_FEB_21);
    expect(row.runs).toEqual(expect.arrayContaining(["Closed"]));
    expect(row.text).not.toContain("Move pickup days");
  });
});
