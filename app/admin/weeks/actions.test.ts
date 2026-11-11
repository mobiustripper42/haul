// Issue 149: the weeks screen's server actions, through an InMemoryRepository with `next/headers` faked and
// `redirect` throwing as the real one does. Who may call them is app/admin/admin-guard.test.ts's (AC13); the
// move check's and the cutoff's edges are src/pickup-week-calendar.test.ts's, and the week credits' are the
// repository contract's (src/adapters/repository-contract.ts). These hold what each action does with them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { ChangedWeek } from "@core/pickup-week.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../../next-headers-fake";
import { redirectOf } from "../../screen-test-helpers";
import { addSupperClub } from "../subscribers-fixture";
import { closeWeek, moveWeek, reopenWeek, saveWeekNote } from "./actions";

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
    throw new Error("the weeks actions send no email");
  },
  getSessionSecret: () => services.secret,
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
