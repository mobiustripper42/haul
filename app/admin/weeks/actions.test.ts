// Issue 149: the weeks screen's server actions, through an InMemoryRepository with `next/headers` faked and
// `redirect` throwing as the real one does. Who may call them is app/admin/admin-guard.test.ts's (AC13); the
// move check's and the cutoff's edges are src/pickup-week-calendar.test.ts's, and the week credits' are the
// repository contract's (src/adapters/week-credit-contract.ts). These hold what each action does with them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "@core/adapters/fake-email.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { legalFooter, renderEmail } from "@core/email-templates.js";
import { createTranslator, type Language } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { pickupWeek, weekTitle, type ChangedWeek } from "@core/pickup-week.js";
import { EmailSendError, type EmailMessage } from "@core/ports/email.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../../next-headers-fake";
import { redirectOf } from "../../screen-test-helpers";
import { addSupperClub } from "../subscribers-fixture";
import { assignMenu, closeWeek, moveWeek, reopenWeek, saveWeekNote } from "./actions";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  email: undefined as unknown as import("@core/ports/email.js").EmailPort,
  secret: "test-session-secret-that-is-long-enough-0123456789",
  siteUrl: "https://members.example.test",
}));
const scheduled = vi.hoisted(() => ({ tasks: [] as unknown[] }));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({
  after: (task: unknown) => {
    scheduled.tasks.push(task);
  },
}));
vi.mock("../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => services.email,
  getSessionSecret: () => services.secret,
  getSiteUrl: () => services.siteUrl,
}));

// Wednesday, February 3, noon in Cleveland. The week of February 7 is past its cutoff (the end of Monday,
// February 1) and its pickup is still to come; February 14's cutoff is the end of Monday, February 8.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const PAST_CUTOFF = "2027-02-07";
const OPEN = "2027-02-14";
const CLOSED_AT = new Date("2027-02-02T15:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const WEEKS_PATH = "/admin/weeks";

let product: ProductWithOptions;
let members = 0;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  product = addSupperClub(services.repo);
  const admin = await services.repo.createMember({ email: "lenny@example.com", role: "admin" });
  request.current.cookies.ocf_session = signSession({ subjectId: admin.id, expiresAt: new Date(NOW.getTime() + DAY).toISOString() }, services.secret);
});

afterEach(() => {
  vi.useRealTimers();
});

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

/** A new member's signup for `week`, charged at signup. */
const paidFor = async (week: string): Promise<PendingSignup> => {
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
  return signup;
};

const changed = (weekOf: string, over: Partial<ChangedWeek>): ChangedWeek => ({ weekOf, closedAt: null, note: null, firstDay: null, lastDay: null, ...over });

const save = (week: ChangedWeek) => services.repo.savePickupWeek(product.id, week);

const rowOf = async (weekOf: string): Promise<ChangedWeek | null> =>
  (await services.repo.listChangedWeeks(product.id, weekOf)).find((week) => week.weekOf === weekOf) ?? null;

const creditsOf = (weekOf: string) => services.repo.listWeekCredits(product.id, weekOf);

/** A redirect's path and query, so a test does not depend on the order the parameters are written in. */
const landing = (url: string) => {
  const parsed = new URL(url, "http://haul.test");
  return { path: parsed.pathname, query: Object.fromEntries(parsed.searchParams) };
};

describe("AC2, AC3 — closeWeek", () => {
  it("AC2: it closes the week with the note given, now, and goes back to the weeks", async () => {
    await expect(redirectOf(closeWeek(form({ week: OPEN, note: "Kitchen flooded" })))).resolves.toBe(WEEKS_PATH);
    expect(await rowOf(OPEN)).toEqual(changed(OPEN, { closedAt: NOW, note: "Kitchen flooded" }));
  });

  it.each([
    ["empty", ""],
    ["spaces only", "   "],
  ])("AC6: a note left %s is saved as no note", async (_what, note) => {
    await redirectOf(closeWeek(form({ week: OPEN, note })));
    expect(await rowOf(OPEN)).toEqual(changed(OPEN, { closedAt: NOW, note: null }));
  });

  it("AC3: closed before its cutoff, each subscription that paid for it at signup gets a week credit, granted now", async () => {
    const signup = await paidFor(OPEN);
    await redirectOf(closeWeek(form({ week: OPEN, note: "" })));
    expect(await creditsOf(OPEN)).toEqual([expect.objectContaining({ subscriptionId: signup.subscriptionId, grantedFor: signup.ledgerId, grantedAt: NOW })]);
  });

  it("AC3: closed after its cutoff, it still closes, and each subscription charged for it gets a week credit", async () => {
    const signup = await paidFor(PAST_CUTOFF);
    await expect(redirectOf(closeWeek(form({ week: PAST_CUTOFF, note: "Kitchen flooded" })))).resolves.toBe(WEEKS_PATH);
    expect((await rowOf(PAST_CUTOFF))?.closedAt).toEqual(NOW);
    expect((await creditsOf(PAST_CUTOFF)).map((credit) => credit.subscriptionId)).toEqual([signup.subscriptionId]);
  });
});

describe("AC7, AC8 — reopenWeek", () => {
  it("AC7: a week closed before its cutoff is open again, its note cleared: no row is left", async () => {
    await save(changed(OPEN, { closedAt: CLOSED_AT, note: "Kitchen flooded" }));
    await expect(redirectOf(reopenWeek(form({ week: OPEN })))).resolves.toBe(WEEKS_PATH);
    expect(await rowOf(OPEN)).toBeNull();
  });

  it("AC7: the week credits its closing gave are withdrawn", async () => {
    await paidFor(OPEN);
    await services.repo.closePickupWeek(product.id, OPEN, null, CLOSED_AT);
    expect(await creditsOf(OPEN)).toHaveLength(1);
    await redirectOf(reopenWeek(form({ week: OPEN })));
    expect(await creditsOf(OPEN)).toEqual([]);
  });

  it("AC7: a move on the reopened week stays", async () => {
    await save(changed(OPEN, { closedAt: CLOSED_AT, note: "Kitchen flooded", firstDay: "2027-02-13", lastDay: "2027-02-14" }));
    await redirectOf(reopenWeek(form({ week: OPEN })));
    expect(await rowOf(OPEN)).toEqual(changed(OPEN, { firstDay: "2027-02-13", lastDay: "2027-02-14" }));
  });

  it("AC8: after its cutoff it refuses: back to the weeks, the week still closed with its note", async () => {
    const closed = changed(PAST_CUTOFF, { closedAt: new Date("2027-01-30T15:00:00.000Z"), note: "Kitchen flooded" });
    await save(closed);
    await expect(redirectOf(reopenWeek(form({ week: PAST_CUTOFF })))).resolves.toBe(WEEKS_PATH);
    expect(await rowOf(PAST_CUTOFF)).toEqual(closed);
  });
});

describe("AC6 — saveWeekNote", () => {
  it("AC6: on a closed week the note changes and nothing else does: the closing and the move stay", async () => {
    const closed = changed(OPEN, { closedAt: CLOSED_AT, note: "Kitchen flooded", firstDay: "2027-02-13", lastDay: "2027-02-14" });
    await save(closed);
    await expect(redirectOf(saveWeekNote(form({ week: OPEN, note: "Generator fixed" })))).resolves.toBe(WEEKS_PATH);
    expect(await rowOf(OPEN)).toEqual({ ...closed, note: "Generator fixed" });
  });

  it("AC6: the week credits stay as they were", async () => {
    await paidFor(OPEN);
    await services.repo.closePickupWeek(product.id, OPEN, "Kitchen flooded", CLOSED_AT);
    const before = await creditsOf(OPEN);
    expect(before).toHaveLength(1);
    await redirectOf(saveWeekNote(form({ week: OPEN, note: "Generator fixed" })));
    expect(await creditsOf(OPEN)).toEqual(before);
  });

  it.each([
    ["empty", ""],
    ["spaces only", "   "],
  ])("AC6: a note saved %s clears it, and the week stays closed", async (_what, note) => {
    await save(changed(OPEN, { closedAt: CLOSED_AT, note: "Kitchen flooded" }));
    await redirectOf(saveWeekNote(form({ week: OPEN, note })));
    expect(await rowOf(OPEN)).toEqual(changed(OPEN, { closedAt: CLOSED_AT, note: null }));
  });

  it("AC6: an open week takes no note: back to the weeks, nothing written, with no row or with a note already", async () => {
    const noted = changed(PAST_CUTOFF, { note: "Heads up" });
    await save(noted);
    await expect(redirectOf(saveWeekNote(form({ week: OPEN, note: "Generator fixed" })))).resolves.toBe(WEEKS_PATH);
    await expect(redirectOf(saveWeekNote(form({ week: PAST_CUTOFF, note: "Generator fixed" })))).resolves.toBe(WEEKS_PATH);
    expect(await rowOf(OPEN)).toBeNull();
    expect(await rowOf(PAST_CUTOFF)).toEqual(noted);
  });
});

describe("AC9–AC11 — moveWeek", () => {
  it("AC9: it moves an open week's pickup days and goes back to the weeks", async () => {
    await expect(redirectOf(moveWeek(form({ week: OPEN, firstDay: "2027-02-13", lastDay: "2027-02-14" })))).resolves.toBe(WEEKS_PATH);
    expect(await rowOf(OPEN)).toEqual(changed(OPEN, { firstDay: "2027-02-13", lastDay: "2027-02-14" }));
  });

  it("AC9: days the check refuses send the form back with the fault and the dates entered, and nothing is written", async () => {
    const url = await redirectOf(moveWeek(form({ week: OPEN, firstDay: "2027-02-08", lastDay: "2027-02-14" })));
    expect(landing(url)).toEqual({ path: WEEKS_PATH, query: { move: OPEN, error: "beforeCutoff", first: "2027-02-08", last: "2027-02-14" } });
    expect(await rowOf(OPEN)).toBeNull();
  });

  it.each([
    ["a first day", "2026-13-01", "2027-02-14"],
    ["a last day", "2027-02-14", "2026-02-32"],
  ])("AC9: a crafted form with %s that is no real date goes back to the weeks and writes nothing", async (_what, firstDay, lastDay) => {
    await expect(redirectOf(moveWeek(form({ week: OPEN, firstDay, lastDay })))).resolves.toBe(WEEKS_PATH);
    expect(await rowOf(OPEN)).toBeNull();
  });

  it("AC11: a closed week cannot be moved: back to the weeks, the week as it was", async () => {
    const closed = changed(OPEN, { closedAt: CLOSED_AT, note: "Kitchen flooded" });
    await save(closed);
    await expect(redirectOf(moveWeek(form({ week: OPEN, firstDay: "2027-02-13", lastDay: "2027-02-14" })))).resolves.toBe(WEEKS_PATH);
    expect(await rowOf(OPEN)).toEqual(closed);
  });

  it("AC10: putBack puts a moved week back to its ordinary days: with no note, no row is left", async () => {
    await save(changed(OPEN, { firstDay: "2027-02-13", lastDay: "2027-02-14" }));
    await expect(redirectOf(moveWeek(form({ week: OPEN, putBack: "1" })))).resolves.toBe(WEEKS_PATH);
    expect(await rowOf(OPEN)).toBeNull();
  });

  it("AC10: a moved week with a note is put back to its ordinary days and keeps the note", async () => {
    await save(changed(OPEN, { note: "Heads up", firstDay: "2027-02-13", lastDay: "2027-02-14" }));
    await redirectOf(moveWeek(form({ week: OPEN, putBack: "1" })));
    expect(await rowOf(OPEN)).toEqual(changed(OPEN, { note: "Heads up" }));
  });
});

// Issue 140: a week's menu. What the repository stores is the menu contract's (src/adapters/menu-contract.ts); these
// hold which weeks the action lets take a menu, what it writes, as whom, and where the admin lands.
describe("AC9–AC11, AC13, AC14 (issue 140) — assignMenu", () => {
  const LAST_LISTED = "2027-04-25";
  const UNKNOWN_MENU = "00000000-0000-4000-8000-000000000000";

  const menu = (name: string) => services.repo.createMenu({ name, texts: {} });
  const weekMenus = () => services.repo.listWeekMenus(product.id, product.firstPickupDate);
  const assign = (week: string, menuId: string) => redirectOf(assignMenu(form({ week, menu: menuId })));

  it("AC9: it puts the menu on the week and goes back to the weeks", async () => {
    const autumn = await menu("Autumn harvest");
    await expect(assign(OPEN, autumn.id)).resolves.toBe(WEEKS_PATH);
    expect(await weekMenus()).toEqual(new Map([[OPEN, autumn.id]]));
  });

  it('AC9: picking another menu replaces it, and "" (No menu) clears it', async () => {
    const [autumn, winter] = [await menu("Autumn harvest"), await menu("Winter roots")];
    await assign(OPEN, autumn.id);
    await assign(OPEN, winter.id);
    expect(await weekMenus()).toEqual(new Map([[OPEN, winter.id]]));
    await expect(assign(OPEN, "")).resolves.toBe(WEEKS_PATH);
    expect(await weekMenus()).toEqual(new Map());
  });

  it("AC9: one menu can be on any number of weeks", async () => {
    const autumn = await menu("Autumn harvest");
    await assign(OPEN, autumn.id);
    await assign(LAST_LISTED, autumn.id);
    expect(await weekMenus()).toEqual(
      new Map([
        [OPEN, autumn.id],
        [LAST_LISTED, autumn.id],
      ]),
    );
  });

  it("AC10: a week past its cutoff takes a menu too, as does the last week listed", async () => {
    const autumn = await menu("Autumn harvest");
    await expect(assign(PAST_CUTOFF, autumn.id)).resolves.toBe(WEEKS_PATH);
    await assign(LAST_LISTED, autumn.id);
    expect(await weekMenus()).toEqual(
      new Map([
        [PAST_CUTOFF, autumn.id],
        [LAST_LISTED, autumn.id],
      ]),
    );
  });

  it.each([
    ["a week whose pickup has passed", "2027-01-31"],
    ["a week beyond the 12 listed", "2027-05-02"],
  ])("AC10: %s is not listed: back to the weeks, nothing written", async (_what, week) => {
    const autumn = await menu("Autumn harvest");
    await expect(assign(week, autumn.id)).resolves.toBe(WEEKS_PATH);
    expect(await weekMenus()).toEqual(new Map());
  });

  it.each([
    ["an unknown menu", UNKNOWN_MENU],
    ["a menu id that isn't a UUID", "not-a-uuid"],
  ])("AC9: %s writes nothing: the week keeps the menu it had", async (_what, menuId) => {
    const autumn = await menu("Autumn harvest");
    await assign(OPEN, autumn.id);
    await expect(assign(OPEN, menuId)).resolves.toBe(WEEKS_PATH);
    expect(await weekMenus()).toEqual(new Map([[OPEN, autumn.id]]));
  });

  it("AC11: a closed week takes no menu and keeps the one it had: back to the weeks, nothing written", async () => {
    const [autumn, winter] = [await menu("Autumn harvest"), await menu("Winter roots")];
    await assign(OPEN, autumn.id);
    await save(changed(OPEN, { closedAt: CLOSED_AT }));
    await expect(assign(OPEN, winter.id)).resolves.toBe(WEEKS_PATH);
    await expect(assign(OPEN, "")).resolves.toBe(WEEKS_PATH);
    expect(await weekMenus()).toEqual(new Map([[OPEN, autumn.id]]));
  });

  it("AC14: it writes as the admin, so the audit row names the admin's member id as who acted", async () => {
    const admin = await services.repo.findMemberByEmail("lenny@example.com");
    const autumn = await menu("Autumn harvest");
    const withActor = vi.spyOn(services.repo, "withActor");
    await assign(OPEN, autumn.id);
    expect(withActor).toHaveBeenCalledWith({ member: admin?.id }, expect.any(Function));
    withActor.mockRestore();
  });

  it.each([
    ["a signed-in member whose role is not admin", "member", "/"],
    ["a signed-out visitor", null, "/sign-in"],
  ] as const)("AC13: %s is sent where the other admin screens send them, and nothing is written", async (_who, role, where) => {
    const autumn = await menu("Autumn harvest");
    if (role) {
      const member = await services.repo.createMember({ email: "rosa@example.com", role });
      request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(NOW.getTime() + DAY).toISOString() }, services.secret);
    } else {
      request.current = emptyRequest();
    }
    await expect(assign(OPEN, autumn.id)).resolves.toBe(where);
    expect(await weekMenus()).toEqual(new Map());
  });
});

// Issue 151: closing a week emails each subscription due it. Who is due is listWeekDue's contract
// (src/adapters/week-credit-contract.ts), as is closePickupWeek's answer; the words are src/email-templates.test.ts's.
// These hold what the action does with them: one `after` per email, run here as Next runs them after the response;
// the member's saved language; nothing for a week already closed; a failed send logged and the rest sent, the close
// standing.
describe("AC1–AC9 (issue 151) — closeWeek's emails", () => {
  const SITE_URL = services.siteUrl;
  const NOTE = "Kitchen flooded";
  let email: FakeEmail;

  beforeEach(() => {
    scheduled.tasks = [];
    email = new FakeEmail();
    services.email = email;
  });

  /** Runs what `after` captured, as Next does once the response has gone. */
  const runScheduled = async (): Promise<void> => {
    for (const task of scheduled.tasks.splice(0)) await (task as () => Promise<void>)();
  };

  const close = (week: string, note = "") => redirectOf(closeWeek(form({ week, note })));

  /** A new member in `language` with an active subscription whose first paid week is `week`. */
  const subscribed = async (week: string, language: Language = "en"): Promise<{ member: Member; signup: PendingSignup }> => {
    const member = await services.repo.createMember({ email: `member-${++members}@example.com`, language });
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
    return { member, signup };
  };

  /** The week's title as the account pages show a closed week: its ordinary days, whatever its move. */
  const titleOf = (week: string, language: Language): string => weekTitle(createTranslator(language), pickupWeek(week, null), language);

  /** The email `to` gets: the template rendered for `week` in `language`, read from the catalog rather than typed. */
  const emailFor = (to: string, name: "weekClosedCredit" | "weekClosedNoCharge", week: string, language: Language = "en"): EmailMessage => ({
    to,
    ...renderEmail(name, language, { week: titleOf(week, language) }, SITE_URL),
  });

  it("AC1: closing a week sends the week-credit email to a subscription that paid for it, after the response, and lands on the weeks", async () => {
    const { member } = await subscribed(OPEN);
    await expect(close(OPEN, NOTE)).resolves.toBe(WEEKS_PATH);
    expect(email.sent).toEqual([]);
    expect(scheduled.tasks).toHaveLength(1);
    await runScheduled();
    expect(email.sent).toEqual([emailFor(member.email, "weekClosedCredit", OPEN)]);
  });

  it("AC2: a subscription from an earlier week with nothing for this one gets the won't-be-charged email", async () => {
    const { member } = await subscribed(PAST_CUTOFF);
    await close(OPEN, NOTE);
    await runScheduled();
    expect(email.sent).toEqual([emailFor(member.email, "weekClosedNoCharge", OPEN)]);
  });

  it("AC3: a subscription that skipped the week gets nothing, while another that did not still does", async () => {
    const skipper = await subscribed(PAST_CUTOFF);
    const other = await subscribed(PAST_CUTOFF);
    expect(await services.repo.skipWeek(skipper.signup.subscriptionId, OPEN)).toBe(true);
    await close(OPEN);
    expect(scheduled.tasks).toHaveLength(1);
    await runScheduled();
    expect(email.sent).toEqual([emailFor(other.member.email, "weekClosedNoCharge", OPEN)]);
  });

  describe("AC6 — the member's saved language, catalog wording", () => {
    const es = createTranslator("es");
    /** What follows a body: the questions line, the sign-off and the legal footer, existing copy read from the catalog. */
    const SPANISH_CLOSE = `${es("email.signupConfirmation.questions")}\n\n${es("email.signOff")}\n\n${legalFooter(es, SITE_URL)}`;

    it("AC6: a member whose saved language is Spanish gets the week-credit email in Spanish, the week's title in Spanish", async () => {
      const { member } = await subscribed(OPEN, "es");
      await close(OPEN, NOTE);
      await runScheduled();
      const week = titleOf(OPEN, "es");
      expect(email.sent).toEqual([
        {
          to: member.email,
          subject: `Sin recogida del Supper Club el ${week}`,
          text: `La granja está cerrada el ${week}: no hay recogida. Ya pagó esta semana, así que tiene un crédito de semana.\n\n${SPANISH_CLOSE}`,
        },
      ]);
    });

    it("AC6: and the won't-be-charged email in Spanish", async () => {
      const { member } = await subscribed(PAST_CUTOFF, "es");
      await close(OPEN, NOTE);
      await runScheduled();
      const week = titleOf(OPEN, "es");
      expect(email.sent).toEqual([
        {
          to: member.email,
          subject: `Sin recogida del Supper Club el ${week}`,
          text: `La granja está cerrada el ${week}: no hay recogida, y no se le cobrará.\n\n${SPANISH_CLOSE}`,
        },
      ]);
    });

    it("AC6: neither email carries the admin's note", async () => {
      await subscribed(OPEN);
      await subscribed(PAST_CUTOFF);
      await close(OPEN, NOTE);
      await runScheduled();
      expect(email.sent).toHaveLength(2);
      for (const message of email.sent) expect(`${message.subject}\n${message.text}`).not.toContain(NOTE);
    });

    it("AC6: {week} is the week's ordinary days even when the week was moved", async () => {
      const moved = changed(OPEN, { firstDay: "2027-02-13", lastDay: "2027-02-14" });
      // The moved title differs from the ordinary one, so the expectation below can tell them apart.
      expect(weekTitle(createTranslator("en"), pickupWeek(OPEN, moved), "en")).not.toBe(titleOf(OPEN, "en"));
      await save(moved);
      const { member } = await subscribed(OPEN);
      await close(OPEN);
      await runScheduled();
      expect(email.sent).toEqual([emailFor(member.email, "weekClosedCredit", OPEN)]);
    });
  });

  describe("AC7 — whether this close closed it", () => {
    it("AC7: a week already closed sends nothing: back to the weeks, no email scheduled", async () => {
      await subscribed(OPEN);
      await save(changed(OPEN, { closedAt: CLOSED_AT, note: NOTE }));
      await expect(close(OPEN, NOTE)).resolves.toBe(WEEKS_PATH);
      expect(scheduled.tasks).toEqual([]);
      await runScheduled();
      expect(email.sent).toEqual([]);
    });

    it("AC7: a week with a row but no closing, a note on it, is open: closing it sends", async () => {
      await save(changed(OPEN, { note: "Heads up" }));
      const { member } = await subscribed(OPEN);
      await close(OPEN, NOTE);
      await runScheduled();
      expect(email.sent).toEqual([emailFor(member.email, "weekClosedCredit", OPEN)]);
    });
  });

  it("AC8: a week reopened before its cutoff and closed again sends its emails again", async () => {
    const { member } = await subscribed(OPEN);
    await close(OPEN, NOTE);
    await runScheduled();
    await expect(redirectOf(reopenWeek(form({ week: OPEN })))).resolves.toBe(WEEKS_PATH);
    await close(OPEN, NOTE);
    await runScheduled();
    expect(email.sent).toEqual([emailFor(member.email, "weekClosedCredit", OPEN), emailFor(member.email, "weekClosedCredit", OPEN)]);
  });

  it("AC9: a send that fails is logged with that member's id; every other email still goes, each from its own `after`, and the week stays closed", async () => {
    const ada = await subscribed(OPEN);
    const grace = await subscribed(OPEN);
    services.email = {
      send: async (message) => {
        if (message.to === ada.member.email) throw new EmailSendError("Resend", 422, "the to field is invalid");
        return email.send(message);
      },
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(close(OPEN, NOTE)).resolves.toBe(WEEKS_PATH);
      expect(scheduled.tasks).toHaveLength(2);
      await expect(runScheduled()).resolves.toBeUndefined();
      expect(email.sent).toEqual([emailFor(grace.member.email, "weekClosedCredit", OPEN)]);
      expect(errors.mock.calls.map(([, fields]) => fields)).toEqual([expect.objectContaining({ memberId: ada.member.id })]);
      expect((await rowOf(OPEN))?.closedAt).toEqual(NOW);
    } finally {
      errors.mockRestore();
    }
  });
});
