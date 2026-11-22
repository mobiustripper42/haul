// Issue 149: the weeks screen, rendered through react-dom/server with `next/headers` faked and the composition
// root mocked, as app/admin/page.test.ts renders /admin. Read as the markup and its text, not the tree, so a
// row or a dialog may be its own component. Which weeks are listed, and their cutoffs, are
// src/pickup-week-calendar.test.ts's; what the actions write is ./actions.test.ts's; who may see the page is
// app/admin/admin-guard.test.ts's. Plurals are `pluralKey`'s (src/i18n.test.ts). The page picks between lines by a
// week's state (which dialog sentence, which cutoff line, which badge, which fault): each choice is checked by the
// expected key's catalog line, the dates and counts in it as values. A control is located by its name.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator, pluralKey, type MessageKey } from "@core/i18n.js";
import { cutoffInstant, type ChangedWeek } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { Hint } from "../../../components/ui/hint";
import { RowActions, type RowAction } from "../../../components/ui/row-actions";
import { emptyRequest } from "../../next-headers-fake";
import { ADMIN_WEEKS_PATH } from "../../paths";
import { attributesOf, escapeRegExp, screenMarkup } from "../../screen-test-helpers";
import { SiteHeader } from "../../site-header";
import { addSupperClub } from "../subscribers-fixture";
import { moveWeek } from "./actions";
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
// Issue 140: the real Hint, wrapped so a test can read the props the page gives it (AC8's danger).
vi.mock("../../../components/ui/hint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../components/ui/hint")>();
  return { Hint: vi.fn(actual.Hint) };
});
// Issue 220: the real RowActions, wrapped so a test can read the actions each row passes it; how it draws them is
// components/ui/row-actions.test.ts's.
vi.mock("../../../components/ui/row-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../components/ui/row-actions")>();
  return { RowActions: vi.fn(actual.RowActions) };
});

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

const FEB_1_CUTOFF = "Monday, February 1";
const FEB_8_CUTOFF = "Monday, February 8";

const t = createTranslator("en");

/** The line for `n` of a plural key, in English, with `n` and `values` filled in. */
const tn = (base: string, n: number, values: Record<string, string | number> = {}): string => t(pluralKey("en", base, n) as MessageKey, { n, ...values });

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

/** The first row: from the start of the list of weeks to the element whose whole text is `next`. */
const firstRowOf = (screen: Screen, next: string): Screen => {
  const m = marked(screen.html.slice(screen.html.indexOf("<ul")));
  const end = runAt(m, next);
  const slice = m.slice(0, end === -1 ? undefined : end);
  return { html: "", text: slice.split(MARK).join(""), runs: runsOf(slice) };
};

/** How many submit buttons the page has. */
const submitCount = (html: string): number => attributesOf(html, "button").filter((button) => button.type === "submit").length;

/** The level-2 headings' text. */
const h2s = (html: string): string[] => [...screenMarkup(html).matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map(([, inner = ""]) => inner.replace(/<[^>]*>/g, "").trim());

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
    const { runs } = await render();
    // The cutoff dates are the only weekday-named dates on the page as it opens.
    const cutoffs = runs.flatMap((run) => run.match(/\b\w+day, \w+ \d+\b/g) ?? []);
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
  it('AC14: the header is asked for with current "admin-weeks"', async () => {
    await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "admin-weeks" }));
  });

  // Issue 159: the admin links moved into the header (faked here), so the page draws no nav of its own.
  it("AC5 (issue 159): /admin/weeks draws no admin nav of its own: no link on it is marked as the page showing", async () => {
    expect(screenMarkup((await render()).html)).not.toMatch(/\baria-current="page"/);
  });

  it("AC14: the page has one level-1 heading, and the weeks are a labelled list", async () => {
    const markup = screenMarkup((await render()).html);
    expect([...markup.matchAll(/<h1\b/g)]).toHaveLength(1);
    const list = /<ul\b[^>]*\baria-label="([^"]+)"/.exec(markup);
    expect(list).not.toBeNull();
    expect(markup.indexOf(TITLE_FEB_7)).toBeGreaterThan(list?.index ?? Infinity);
  });
});

describe("AC2, AC3, AC14 — the close dialog", () => {
  it("AC2, AC14: ?close on a week nobody has paid for: the dialog, before the weeks, says nobody was charged and names the cutoff", async () => {
    const { text, html } = await render({ close: OPEN });
    expect(text).toContain(t("admin.weeks.closeNobody", { cutoff: FEB_8_CUTOFF }));
    const markup = screenMarkup(html);
    expect(markup.indexOf('name="note"')).toBeGreaterThan(-1);
    expect(markup.indexOf('name="note"')).toBeLessThan(markup.indexOf("<ul"));
  });

  it("AC2: the dialog's heading is a level-2 heading naming the week", async () => {
    const headings = h2s((await render({ close: OPEN })).html);
    expect(headings).toHaveLength(1);
    expect(headings[0]).toContain(TITLE_FEB_14);
  });

  it("AC2: the dialog's form sends the week and a note", async () => {
    const { html } = await render({ close: OPEN });
    expect(hasControl(html, "week", OPEN)).toBe(true);
    expect(controls(html)).toContainEqual(expect.objectContaining({ tag: "textarea", name: "note" }));
  });

  it("AC3, AC14: before the cutoff with 3 paid at signup: who paid", async () => {
    await paidFor(OPEN, 3);
    const { text } = await render({ close: OPEN });
    expect(text).toContain(tn("admin.weeks.closeBefore", 3, { cutoff: FEB_8_CUTOFF }));
    expect(text).not.toContain(t("admin.weeks.closeNobody", { cutoff: FEB_8_CUTOFF }));
  });

  it("AC3, AC14: after the cutoff: who was charged and when", async () => {
    await paidFor(PAST_CUTOFF, 2);
    const { text } = await render({ close: PAST_CUTOFF });
    expect(text).toContain(tn("admin.weeks.closeAfter", 2, { cutoff: FEB_1_CUTOFF }));
  });

  // Issue 231, AC4: the close dialog's note goes to the members, so it starts with the note the week already has.
  it("AC4 (issue 231): ?close on a week with a note: the dialog's note field starts with that note", async () => {
    await save(OPEN, { note: "Heads up: the side door" });
    const { html } = await render({ close: OPEN });
    expect(controls(html).filter((control) => control.name === "note")).toEqual([
      expect.objectContaining({ tag: "textarea", value: "Heads up: the side door" }),
    ]);
  });

  it("AC4 (issue 231): ?close on a week with no note: the dialog's note field starts empty", async () => {
    const { html } = await render({ close: OPEN });
    expect(controls(html).filter((control) => control.name === "note")).toEqual([expect.objectContaining({ tag: "textarea", value: "" })]);
  });
});

// Issue 221: the close dialog says how many members get an email. Who is due a week, and so emailed, is listWeekDue's
// contract (src/adapters/week-credit-contract.ts); what closeWeek sends is ./actions.test.ts's. These hold that the
// dialog shows listWeekDue's count for the week, with one member due and one not, and the line for nobody due.
describe("AC1, AC2 (issue 221) — the close dialog's emails", () => {
  /** A week before the list's first, so its subscribers are due every listed week until they skip one. */
  const EARLIER = "2027-01-31";

  /** A subscriber since EARLIER who skipped `week`: not due it. */
  const skipped = async (week: string): Promise<void> => {
    const member = await services.repo.createMember({ email: `member-${++members}@example.com` });
    const signup = await services.repo.savePendingSignup({
      memberId: member.id,
      productId: product.id,
      choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
      firstChargeCents: 8000,
      weeklyCents: 8000,
      pickupDate: EARLIER,
      consentText: "I agree to a weekly charge of $80.",
      consentAt: new Date("2027-01-20T15:00:00.000Z"),
    });
    await services.repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, new Date("2027-01-20T15:00:05.000Z"));
    const subscription = await services.repo.findActiveSubscription(member.id, product.id);
    await services.repo.skipWeek(subscription?.id ?? "no subscription", week);
  };

  /** How many members listWeekDue gives for `week`: the members the close emails. */
  const dueFor = async (week: string): Promise<number> => (await services.repo.listWeekDue(product.id, week, cutoffInstant(product, week))).length;

  /** The close dialog: from its heading to the list of weeks. */
  const dialogOf = (screen: Screen): Screen => {
    const markup = screenMarkup(screen.html);
    return screenOf(markup.slice(markup.indexOf("<h2"), markup.indexOf("<ul")));
  };

  /** The words of a line this task adds, refused while the catalog has none, so a check that it shows is never vacuous. */
  const lineOf = (key: MessageKey): string => {
    const line = t(key);
    expect(line, `${key} has no words in the catalog`).not.toBe("");
    return line;
  };

  it("AC1 (issue 221): before the cutoff, the dialog shows listWeekDue's count: those paid for the week and those due it, not one who skipped it", async () => {
    await paidFor(OPEN, 2);
    await paidFor(EARLIER, 4);
    await skipped(OPEN);
    const due = await dueFor(OPEN);
    // The fixture: 2 + 4 due, the one who skipped not; a count no other number in the dialog shares.
    expect(due).toBe(6);
    const dialog = dialogOf(await render({ close: OPEN }));
    expect(dialog.text).toMatch(new RegExp(`\\b${due}\\b`));
    expect(dialog.text).toContain(tn("admin.weeks.closeEmails", due));
    expect(dialog.text).not.toContain(lineOf("admin.weeks.closeEmailsNone"));
  });

  it("AC1 (issue 221): after the cutoff, the dialog shows listWeekDue's count: those charged and those due, not one whose first week is later", async () => {
    await paidFor(PAST_CUTOFF, 2);
    await paidFor(EARLIER, 3);
    await paidFor(OPEN, 1);
    const due = await dueFor(PAST_CUTOFF);
    // The fixture: 2 + 3 due, the one starting February 14 not; a count no other number in the dialog shares.
    expect(due).toBe(5);
    const dialog = dialogOf(await render({ close: PAST_CUTOFF }));
    expect(dialog.text).toMatch(new RegExp(`\\b${due}\\b`));
    expect(dialog.text).toContain(tn("admin.weeks.closeEmails", due));
    expect(dialog.text).not.toContain(lineOf("admin.weeks.closeEmailsNone"));
  });

  it("AC2 (issue 221): an open week nobody is due: the dialog shows the line for nobody emailed, and no count", async () => {
    await paidFor("2027-02-21", 1);
    expect(await dueFor(OPEN)).toBe(0);
    const dialog = dialogOf(await render({ close: OPEN }));
    expect(dialog.text).toContain(lineOf("admin.weeks.closeEmailsNone"));
    expect(dialog.text).not.toContain(tn("admin.weeks.closeEmails", 0));
  });
});

describe("AC7, AC14 — the reopen dialog", () => {
  it("AC7, AC14: ?reopen on a week whose closing gave 2 week credits says they are taken back, and names the cutoff", async () => {
    await paidFor(OPEN, 2);
    await services.repo.closePickupWeek(product.id, OPEN, null, BEFORE_FEB_14_CUTOFF);
    const { text, html } = await render({ reopen: OPEN });
    expect(text).toContain(tn("admin.weeks.reopenGave", 2));
    expect(text).toContain(t("admin.weeks.reopenCharged", { cutoff: FEB_8_CUTOFF }));
    expect(h2s(html)[0]).toContain(TITLE_FEB_14);
    expect(hasControl(html, "week", OPEN)).toBe(true);
  });

  it("AC7, AC14: ?reopen on a week whose closing gave none says so", async () => {
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF });
    const { text } = await render({ reopen: OPEN });
    expect(text).toContain(t("admin.weeks.reopenGaveNone"));
  });
});

describe("AC1, AC2, AC14 — an open row", () => {
  it("AC14: an open week's row has its cutoff, Move days and Close week, and no badge", async () => {
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    expect(row.runs).toContain(t("admin.weeks.cutoff", { cutoff: FEB_8_CUTOFF }));
    expect(row.runs).not.toContain(t("admin.weeks.badgeClosed"));
    expect(row.runs).not.toContain(t("admin.weeks.badgeMoved"));
    expect(targets(screen.html, "Reopen")).not.toContainEqual({ reopen: OPEN });
    expect(hasControl(screen.html, "putBack")).toBe(false);
    expect(targets(screen.html, "Close week")).toContainEqual({ close: OPEN });
    expect(targets(screen.html, "Move days")).toContainEqual({ move: OPEN });
  });

  it("AC1, AC14: a week past its cutoff reads Cutoff passed, with how many were charged", async () => {
    await paidFor(PAST_CUTOFF, 2);
    const row = rowOf(await render(), TITLE_FEB_7, TITLE_FEB_14);
    expect(row.runs).toContain(t("admin.weeks.cutoffPassedCharged", { cutoff: FEB_1_CUTOFF, n: 2 }));
  });
});

describe("AC2, AC6–AC8, AC14 — a closed row", () => {
  it("AC2, AC7, AC14: closed before its cutoff: Closed and Note, its week credits, its note, Edit note and Reopen, and no move", async () => {
    await paidFor(OPEN, 2);
    await services.repo.closePickupWeek(product.id, OPEN, "Kitchen flooded", BEFORE_FEB_14_CUTOFF);
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    expect(row.runs).toEqual(expect.arrayContaining([t("admin.weeks.badgeClosed"), t("admin.weeks.badgeNote"), tn("admin.weeks.creditsGiven", 2)]));
    expect(row.text).toContain("Kitchen flooded");
    expect(targets(screen.html, "Move days")).not.toContainEqual({ move: OPEN });
    expect(targets(screen.html, "Close week")).not.toContainEqual({ close: OPEN });
    expect(targets(screen.html, "Add note")).not.toContainEqual({ note: OPEN });
    expect(hasControl(screen.html, "putBack")).toBe(false);
    expect(targets(screen.html, "Reopen")).toContainEqual({ reopen: OPEN });
    expect(targets(screen.html, "Edit note")).toContainEqual({ note: OPEN });
  });

  it("AC6, AC14: a closed week with no note offers Add note", async () => {
    await paidFor(OPEN, 1);
    await services.repo.closePickupWeek(product.id, OPEN, null, BEFORE_FEB_14_CUTOFF);
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    expect(row.runs).toContain(t("admin.weeks.badgeClosed"));
    expect(row.runs).not.toContain(t("admin.weeks.badgeNote"));
    expect(targets(screen.html, "Edit note")).not.toContainEqual({ note: OPEN });
    expect(targets(screen.html, "Add note")).toContainEqual({ note: OPEN });
  });

  it("AC8, AC14: closed after its cutoff: the closure stands, with its week credits, and no Reopen", async () => {
    await paidFor(PAST_CUTOFF, 2);
    await services.repo.closePickupWeek(product.id, PAST_CUTOFF, null, NOW);
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_7, TITLE_FEB_14);
    expect(row.runs).toContain(t("admin.weeks.badgeClosed"));
    expect(row.runs).toContain(tn("admin.weeks.closedAfter", 2));
    expect(row.runs).not.toContain(tn("admin.weeks.creditsGiven", 2));
    expect(targets(screen.html, "Reopen")).not.toContainEqual({ reopen: PAST_CUTOFF });
  });

  it("AC8: closed before its cutoff, which has since passed: no Reopen", async () => {
    await save(PAST_CUTOFF, { closedAt: new Date("2027-01-30T15:00:00.000Z") });
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_7, TITLE_FEB_14);
    expect(row.runs).toContain(t("admin.weeks.badgeClosed"));
    expect(row.runs).not.toContain(tn("admin.weeks.closedAfter", 0));
    expect(row.runs).not.toContain(tn("admin.weeks.creditsGiven", 0));
    expect(targets(screen.html, "Reopen")).not.toContainEqual({ reopen: PAST_CUTOFF });
  });

  it("AC11: a closed week that was moved shows no move: no Moved, no moved-from line, no Move days or Put back", async () => {
    await save(PAST_CUTOFF, { closedAt: new Date("2027-01-30T15:00:00.000Z"), firstDay: "2027-02-06", lastDay: "2027-02-07" });
    const screen = await render();
    // The first row runs from the start of the list to February 14's title, whatever a closed moved week is titled.
    const row = firstRowOf(screen, TITLE_FEB_14);
    expect(row.runs).toContain(t("admin.weeks.badgeClosed"));
    expect(row.runs).not.toContain(t("admin.weeks.badgeMoved"));
    expect(row.runs).not.toContain(t("admin.weeks.movedFrom", { days: TITLE_FEB_7 }));
    expect(targets(screen.html, "Move days")).not.toContainEqual({ move: PAST_CUTOFF });
    expect(hasControl(screen.html, "putBack")).toBe(false);
  });
});

describe("AC9, AC10, AC14 — a moved row", () => {
  it("AC9, AC10, AC14: titled by its days, Moved, the days it moved from, the same cutoff, Move days, Put back and Close week", async () => {
    await save(OPEN, { firstDay: "2027-02-13", lastDay: "2027-02-14" });
    const screen = await render();
    const row = rowOf(screen, "Saturday, February 13 and Sunday, February 14", TITLE_FEB_21);
    expect(row.runs).toContain(t("admin.weeks.badgeMoved"));
    expect(row.runs).toContain(t("admin.weeks.movedFrom", { days: TITLE_FEB_14 }));
    expect(row.runs).toContain(t("admin.weeks.cutoff", { cutoff: FEB_8_CUTOFF }));
    expect(targets(screen.html, "Move days")).toContainEqual({ move: OPEN });
    expect(targets(screen.html, "Close week")).toContainEqual({ close: OPEN });
    expect(hasControl(screen.html, "putBack")).toBe(true);
  });

  it("AC10: Put back sends the week to moveWeek with putBack", async () => {
    await save(OPEN, { firstDay: "2027-02-13", lastDay: "2027-02-14" });
    const { html } = await render();
    expect(hasControl(html, "putBack")).toBe(true);
    expect(hasControl(html, "week", OPEN)).toBe(true);
  });
});

describe("AC6, AC14 — the note panel", () => {
  /** The note panel's Cancel: a secondary-button link back to the weeks list. */
  const secondaryCancels = (html: string) => attributesOf(html, "a").filter((a) => a.href === ADMIN_WEEKS_PATH && (a.class ?? "").split(" ").includes("btn-secondary"));

  // Eric, 2026-11-21: Clear note is gone; emptying the field and saving clears it, and Cancel takes Clear's place.
  it("AC6, AC14: ?note on a closed week with a note opens the panel: the note's text, the week, Save note alone and Cancel as the secondary button", async () => {
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF, note: "Kitchen flooded" });
    const screen = await render({ note: OPEN });
    expect(hasControl(screen.html, "week", OPEN)).toBe(true);
    expect(controls(screen.html)).toContainEqual(expect.objectContaining({ tag: "textarea", name: "note", value: "Kitchen flooded" }));
    expect(submitCount(screen.html)).toBe(1);
    expect(controls(screen.html)).not.toContainEqual(expect.objectContaining({ tag: "input", name: "note" }));
    expect(secondaryCancels(screen.html)).toHaveLength(1);
  });

  it("AC6: with no note, the same panel: Save note alone and Cancel as the secondary button", async () => {
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF });
    const { html } = await render({ note: OPEN });
    expect(controls(html)).toContainEqual(expect.objectContaining({ tag: "textarea", name: "note" }));
    expect(submitCount(html)).toBe(1);
    expect(secondaryCancels(html)).toHaveLength(1);
  });

  // Issue 231 retargets this test: an open week before its cutoff takes a note from the screen.
  it("AC6: ?note on an open week before its cutoff opens the panel: the note field and the week", async () => {
    const { html } = await render({ note: OPEN });
    expect(controls(html)).toContainEqual(expect.objectContaining({ tag: "textarea", name: "note", value: "" }));
    expect(hasControl(html, "week", OPEN)).toBe(true);
  });

  it("AC2 (issue 231): ?note on a week past its cutoff opens nothing: closed with a note, the note stays on its row and no note field opens", async () => {
    await services.repo.closePickupWeek(product.id, PAST_CUTOFF, "Kitchen flooded", NOW);
    const screen = await render({ note: PAST_CUTOFF });
    expect(controls(screen.html).filter((control) => control.name === "note")).toEqual([]);
    expect(rowOf(screen, TITLE_FEB_7, TITLE_FEB_14).text).toContain("Kitchen flooded");
  });
});

describe("AC9, AC11, AC14 — the move panel", () => {
  it("AC9, AC14: ?move on an open week opens the panel in its row: the week, its first and last day", async () => {
    const screen = await render({ move: OPEN });
    expect(controls(screen.html)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "input", name: "firstDay", type: "date" }),
        expect.objectContaining({ tag: "input", name: "lastDay", type: "date" }),
      ]),
    );
    expect(hasControl(screen.html, "week", OPEN)).toBe(true);
  });

  it.each([
    ["beforeCutoff", "2027-02-08", "2027-02-14", () => t("admin.weeks.errorBeforeCutoff", { cutoff: FEB_8_CUTOFF }), "firstDay"],
    ["order", "2027-02-14", "2027-02-13", () => t("admin.weeks.errorOrder"), "lastDay"],
    ["overlapsNext", "2027-02-14", "2027-02-16", () => t("admin.weeks.errorOverlapsNext", { day: "Tuesday, February 16", cutoff: "Monday, February 15" }), "lastDay"],
  ])("AC9: error=%s shows its fault under the day at fault, with the dates entered back in the inputs", async (error, first, last, fault, atFault) => {
    const screen = await render({ move: OPEN, error, first, last });
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    expect(row.runs).toContain(fault());
    // The input at fault is marked invalid and described by the fault; the other is not.
    const inputs = attributesOf(screen.html, "input").filter((input) => input.name === "firstDay" || input.name === "lastDay");
    expect(inputs.filter((input) => input["aria-invalid"] === "true").map((input) => input.name)).toEqual([atFault]);
    const describedBy = inputs.find((input) => input.name === atFault)?.["aria-describedby"]?.split(" ")[0] ?? "no id";
    expect(screenMarkup(screen.html)).toMatch(new RegExp(`\\bid="${escapeRegExp(describedBy)}"[^>]*>\\s*${escapeRegExp(fault())}\\s*<`));
    expect(hasControl(screen.html, "firstDay", first)).toBe(true);
    expect(hasControl(screen.html, "lastDay", last)).toBe(true);
  });

  // moveWeek only sends a fault back with two real dates, so a query carrying anything else was typed by hand: the
  // panel opens as if no move had been refused, with the week's own days and no fault.
  it.each([
    ["order", "2027-02-14", "not-a-date"],
    ["overlapsNext", "2027-02-14", "2026-13-01"],
    ["beforeCutoff", "2026-02-32", "2027-02-15"],
  ])("AC9: error=%s with a date that is no real date opens the panel as if nothing was refused", async (error, first, last) => {
    const screen = await render({ move: OPEN, error, first, last });
    expect(hasControl(screen.html, "firstDay", "2027-02-14")).toBe(true);
    expect(hasControl(screen.html, "lastDay", "2027-02-15")).toBe(true);
    expect(attributesOf(screen.html, "input").filter((input) => input["aria-invalid"] !== undefined)).toEqual([]);
  });

  it("AC11: ?move on a closed week opens nothing", async () => {
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF });
    const screen = await render({ move: OPEN });
    expect(rowOf(screen, TITLE_FEB_14, TITLE_FEB_21).runs).toContain(t("admin.weeks.badgeClosed"));
    expect(hasControl(screen.html, "firstDay")).toBe(false);
  });
});

// Issue 140: a week's menu on the calendar. Which weeks may take one is assignMenu's (./actions.test.ts); the menus
// are made through the repository. "No menu yet" is read as the Hint the page draws, its props through the mock of
// components/ui/hint above; how `danger` looks is components/ui/hint.test.ts's.
describe("AC1, AC5, AC8–AC12 (issue 140) — a week's menu", () => {
  beforeEach(() => {
    vi.mocked(Hint).mockClear();
  });

  const menu = (name: string) => services.repo.createMenu({ name, texts: {} });
  const assign = (weekOf: string, menuId: string) => services.repo.assignWeekMenu(product.id, weekOf, menuId);

  /** Every Hint the page drew, as the props it was given. */
  const hints = () => vi.mocked(Hint).mock.calls.map(([props]) => props as { danger?: boolean; children?: unknown });

  /** The panel's select: its name and each option's value and label. */
  const selectOf = (html: string) => {
    const [, attrs = "", inner = ""] = /<select\b([^>]*)>([\s\S]*?)<\/select>/.exec(screenMarkup(html)) ?? [];
    return {
      name: /\bname="([^"]*)"/.exec(attrs)?.[1],
      options: [...inner.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([, a = "", label = ""]) => ({
        value: /\bvalue="([^"]*)"/.exec(a)?.[1] ?? "",
        label: label.trim(),
      })),
    };
  };

  it("AC8: an open week with a menu names it, under the cutoff line, and offers Change menu", async () => {
    const autumn = await menu("Autumn harvest");
    await assign(OPEN, autumn.id);
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    const cutoffAt = row.text.indexOf(t("admin.weeks.cutoff", { cutoff: FEB_8_CUTOFF }));
    expect(cutoffAt).toBeGreaterThan(-1);
    expect(row.text.indexOf("Autumn harvest")).toBeGreaterThan(cutoffAt);
    expect(row.runs).not.toContain(t("admin.weeks.noMenuYet"));
    expect(targets(screen.html, "Assign menu")).not.toContainEqual({ menu: OPEN });
    expect(targets(screen.html, "Change menu")).toContainEqual({ menu: OPEN });
  });

  it("AC8: an open week with no menu says it has none, in danger, and offers Assign menu", async () => {
    await menu("Autumn harvest");
    const screen = await render();
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    expect(row.runs).toContain(t("admin.weeks.noMenuYet"));
    expect(targets(screen.html, "Change menu")).not.toContainEqual({ menu: OPEN });
    expect(targets(screen.html, "Assign menu")).toContainEqual({ menu: OPEN });
    const noMenu = hints().filter((props) => props.children === t("admin.weeks.noMenuYet"));
    expect(noMenu.length).toBeGreaterThan(0);
    expect(noMenu.every((props) => props.danger === true)).toBe(true);
  });

  it("AC8: the line naming a week's menu is a Hint, not in danger", async () => {
    const autumn = await menu("Autumn harvest");
    for (const week of [PAST_CUTOFF, OPEN]) await assign(week, autumn.id);
    await render();
    const named = hints().filter((props) => String(props.children).includes("Autumn harvest"));
    expect(named).toHaveLength(2);
    expect(named.filter((props) => props.danger === true)).toEqual([]);
  });

  it("AC10: a week past its cutoff has the menu line and Assign menu too", async () => {
    const screen = await render();
    expect(rowOf(screen, TITLE_FEB_7, TITLE_FEB_14).runs).toContain(t("admin.weeks.noMenuYet"));
    expect(targets(screen.html, "Assign menu")).toContainEqual({ menu: PAST_CUTOFF });
  });

  it("AC5: a week holds the menu itself: once the menu is saved under a new name, the week reads the new name", async () => {
    const autumn = await menu("Autumn harvest");
    await assign(OPEN, autumn.id);
    await services.repo.saveMenu(autumn.id, { name: "Late autumn", texts: {} });
    const row = rowOf(await render(), TITLE_FEB_14, TITLE_FEB_21);
    expect(row.text).toContain("Late autumn");
    expect(row.text).not.toContain("Autumn harvest");
  });

  it("AC11: a closed week shows no menu line and no menu control, and ?menu on it opens nothing", async () => {
    const autumn = await menu("Autumn harvest");
    await assign(OPEN, autumn.id);
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF });
    const screen = await render({ menu: OPEN });
    const row = rowOf(screen, TITLE_FEB_14, TITLE_FEB_21);
    expect(row.runs).toContain(t("admin.weeks.badgeClosed"));
    expect(row.text).not.toContain("Autumn harvest");
    expect(row.runs).not.toContain(t("admin.weeks.noMenuYet"));
    expect(targets(screen.html, "Assign menu")).not.toContainEqual({ menu: OPEN });
    expect(targets(screen.html, "Change menu")).not.toContainEqual({ menu: OPEN });
    expect(selectOf(screen.html).name).toBeUndefined();
  });

  it("AC11: the assignment is kept, and shows again once the week is reopened", async () => {
    const autumn = await menu("Autumn harvest");
    await assign(OPEN, autumn.id);
    await services.repo.closePickupWeek(product.id, OPEN, null, BEFORE_FEB_14_CUTOFF);
    await services.repo.reopenPickupWeek(product.id, OPEN);
    const screen = await render();
    expect(rowOf(screen, TITLE_FEB_14, TITLE_FEB_21).text).toContain("Autumn harvest");
    expect(targets(screen.html, "Change menu")).toContainEqual({ menu: OPEN });
  });

  it("AC9: ?menu=<week> opens the panel in its row: a level-2 heading naming the week, the Menu select, and the week", async () => {
    await menu("Autumn harvest");
    const screen = await render({ menu: OPEN });
    const headings = h2s(screen.html);
    expect(headings).toHaveLength(1);
    expect(headings[0]).toContain(TITLE_FEB_14);
    expect(selectOf(screen.html).name).toBe("menu");
    expect(hasControl(screen.html, "week", OPEN)).toBe(true);
  });

  it("AC9: the select offers No menu first, then every menu in name order, case ignored", async () => {
    const zucchini = await menu("Zucchini bread");
    const apple = await menu("apple tart");
    const beet = await menu("Beet soup");
    const { options } = selectOf((await render({ menu: OPEN })).html);
    expect(options.map((option) => option.value)).toEqual(["", apple.id, beet.id, zucchini.id]);
    expect(options.slice(1).map((option) => option.label)).toEqual(["apple tart", "Beet soup", "Zucchini bread"]);
  });

  it("AC12: with no menus in the library the panel says so and links to New menu, with no select", async () => {
    const screen = await render({ menu: OPEN });
    expect(rowOf(screen, TITLE_FEB_14, TITLE_FEB_21).runs).toContain(t("admin.weeks.noMenusYet"));
    expect(screenMarkup(screen.html)).toMatch(/<a\b[^>]*href="\/admin\/menus\/new"/);
    expect(selectOf(screen.html).name).toBeUndefined();
  });
});

// Issue 220: every row's actions go through RowActions, read as the props each row passes it through the mock above:
// which action is main, and which others in which order. Each action is read as what it asks for — a link's path and
// query, a form's action and fields — not its words: which line a menu or note action shows is checked above (issue
// 140's AC8, AC6). The More's screen-reader name is read for the row's title only; its words are checked by hand.
describe("AC1–AC5 (issue 220) — what each row passes RowActions", () => {
  beforeEach(() => {
    vi.mocked(RowActions).mockClear();
  });

  // Issue 231: a row past its cutoff and closed has no action at all, so `main` may be absent.
  type Passed = { main?: RowAction; others: RowAction[]; moreLabel: string; moreName: string };

  /** An action as what it asks for: a link as its path and query, a form as its action and fields. */
  const asked = (action: RowAction) => {
    if (!("href" in action)) return { action: action.action, fields: action.fields };
    const url = new URL(action.href, "http://haul.test");
    return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
  };

  /** A link back to the calendar with one panel asked for. */
  const panel = (name: string, weekOf: string) => ({ path: ADMIN_WEEKS_PATH, query: { [name]: weekOf } });

  /** Whether `action` is about `weekOf`: a link whose query names it, or a form posting it. */
  const about = (action: RowAction | undefined, weekOf: string): boolean =>
    action === undefined ? false : "href" in action ? Object.values(asked(action).query ?? {}).includes(weekOf) : action.fields.week === weekOf;

  /** The props the row for `weekOf` passed RowActions, refused unless exactly one row's actions are about it. */
  const passedFor = (weekOf: string): Passed => {
    const found = vi
      .mocked(RowActions)
      .mock.calls.map(([props]) => props as Passed)
      .filter(({ main, others }) => [main, ...others].some((action) => about(action, weekOf)));
    expect(found, `RowActions calls for ${weekOf}`).toHaveLength(1);
    return found[0] as Passed;
  };

  /** Issue 231: the props of the one row whose More is named with `title`, for a row with no action to find it by. */
  const passedNamed = (title: string): Passed => {
    const found = vi
      .mocked(RowActions)
      .mock.calls.map(([props]) => props as Passed)
      .filter(({ moreName }) => moreName.includes(title));
    expect(found, `RowActions calls named for ${title}`).toHaveLength(1);
    return found[0] as Passed;
  };

  // Issue 231 retargets this test and the two after it: an open week before its cutoff has its ?note= link after Close week.
  it("AC1 (issue 220): an open week with no menu: main is its ?menu= link; the others, in order, its ?move=, ?close= and ?note= links, and no Put back", async () => {
    await render();
    const { main, others } = passedFor(OPEN);
    expect(asked(main as RowAction)).toEqual(panel("menu", OPEN));
    expect(others.map(asked)).toEqual([panel("move", OPEN), panel("close", OPEN), panel("note", OPEN)]);
  });

  it("AC1 (issue 220): each open row's More is named for a screen reader with that row's title", async () => {
    await render();
    expect(passedFor(OPEN).moreName).toContain(TITLE_FEB_14);
    expect(passedFor("2027-02-21").moreName).toContain(TITLE_FEB_21);
  });

  it("AC2 (issue 220): an open week with a menu: main is still its ?menu= link, the others as with no menu", async () => {
    const autumn = await services.repo.createMenu({ name: "Autumn harvest", texts: {} });
    await services.repo.assignWeekMenu(product.id, OPEN, autumn.id);
    await render();
    const { main, others } = passedFor(OPEN);
    expect(asked(main as RowAction)).toEqual(panel("menu", OPEN));
    expect(others.map(asked)).toEqual([panel("move", OPEN), panel("close", OPEN), panel("note", OPEN)]);
  });

  it("AC3 (issue 220): an open, moved week: the others are its ?move= link, Put back posting moveWeek with putBack=1, then its ?close= and ?note= links", async () => {
    await save(OPEN, { firstDay: "2027-02-13", lastDay: "2027-02-14" });
    await render();
    const { main, others } = passedFor(OPEN);
    expect(asked(main as RowAction)).toEqual(panel("menu", OPEN));
    expect(others.map(asked)).toEqual([panel("move", OPEN), { action: moveWeek, fields: { week: OPEN, putBack: "1" } }, panel("close", OPEN), panel("note", OPEN)]);
  });

  it("AC4 (issue 220): a closed week that can reopen: main is its ?reopen= link, its one other its ?note= link", async () => {
    await save(OPEN, { closedAt: BEFORE_FEB_14_CUTOFF });
    await render();
    const { main, others } = passedFor(OPEN);
    expect(asked(main as RowAction)).toEqual(panel("reopen", OPEN));
    expect(others.map(asked)).toEqual([panel("note", OPEN)]);
  });

  // Issue 231 retargets this test: a week past its cutoff takes no note, so a closed one has no action at all.
  it("AC5 (issue 220): a closed week that can't reopen, its cutoff passed: RowActions is given no main and no others", async () => {
    await paidFor(PAST_CUTOFF, 1);
    await services.repo.closePickupWeek(product.id, PAST_CUTOFF, null, NOW);
    await render();
    const { main, others } = passedNamed(TITLE_FEB_7);
    expect(main).toBeUndefined();
    expect(others).toEqual([]);
  });

  // Issue 231, AC2: the note action is offered on every week whose cutoff has not passed, open or closed, and on no other.
  // Its words are the choice between Add note and Edit note, read as the expected key's catalog line. Where the cutoff
  // falls is AdminWeek.cutoffPassed's (src/pickup-week-calendar.test.ts); here one week each side of it.
  describe("AC2 (issue 231) — the note action", () => {
    const NOTED = "Heads up: the side door";

    it("AC2 (issue 231): an open week before its cutoff with no note: its last other is its ?note= link, Add note", async () => {
      await render();
      const note = passedFor(OPEN).others.at(-1);
      expect(note && asked(note)).toEqual(panel("note", OPEN));
      expect(note?.label).toBe(t("admin.weeks.addNote"));
    });

    it("AC2 (issue 231): an open week before its cutoff with a note: its last other is its ?note= link, Edit note, and the note is on its row", async () => {
      await save(OPEN, { note: NOTED });
      const screen = await render();
      const note = passedFor(OPEN).others.at(-1);
      expect(note && asked(note)).toEqual(panel("note", OPEN));
      expect(note?.label).toBe(t("admin.weeks.editNote"));
      expect(rowOf(screen, TITLE_FEB_14, TITLE_FEB_21).text).toContain(NOTED);
    });

    it("AC2 (issue 231): an open week past its cutoff: no note action, and its note still reaches its row", async () => {
      await save(PAST_CUTOFF, { note: NOTED });
      const screen = await render();
      const { main, others } = passedFor(PAST_CUTOFF);
      expect([main, ...others].map((action) => action && asked(action))).not.toContainEqual(panel("note", PAST_CUTOFF));
      expect(others.map(asked)).toEqual([panel("move", PAST_CUTOFF), panel("close", PAST_CUTOFF)]);
      expect(rowOf(screen, TITLE_FEB_7, TITLE_FEB_14).text).toContain(NOTED);
    });

    it("AC2 (issue 231): a closed week past its cutoff with a note: no action at all, and its note still reaches its row", async () => {
      await services.repo.closePickupWeek(product.id, PAST_CUTOFF, NOTED, NOW);
      const screen = await render();
      const { main, others } = passedNamed(TITLE_FEB_7);
      expect(main).toBeUndefined();
      expect(others).toEqual([]);
      expect(rowOf(screen, TITLE_FEB_7, TITLE_FEB_14).text).toContain(NOTED);
    });
  });
});

// Issue 220, AC7: the ?menu= panel's Cancel, a link back to the calendar with nothing asked for. The page's only such
// link is the panel's: every row action asks for a panel, and the header is faked.
describe("AC7 (issue 220) — the menu panel's Cancel", () => {
  /** The links in the open panel, from its heading to the end of its row, that go back to the calendar as it opens. */
  const cancelsIn = (html: string): Array<Record<string, string>> => {
    const markup = screenMarkup(html);
    const from = markup.indexOf("<h2");
    const panelMarkup = from === -1 ? "" : markup.slice(from, markup.indexOf("</li>", from));
    return attributesOf(panelMarkup, "a").filter((link) => link.href === ADMIN_WEEKS_PATH);
  };

  it("AC7 (issue 220): with an empty menu library, the ?menu= panel has a link back to the calendar", async () => {
    const { html } = await render({ menu: OPEN });
    expect(cancelsIn(html)).toHaveLength(1);
  });

  it("AC7 (issue 220): with menus in the library, the ?menu= panel has one too", async () => {
    await services.repo.createMenu({ name: "Autumn harvest", texts: {} });
    const { html } = await render({ menu: OPEN });
    expect(cancelsIn(html)).toHaveLength(1);
  });
});
