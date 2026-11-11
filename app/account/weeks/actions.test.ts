// Issue 137: Skip and Unskip on Upcoming weeks, through an InMemoryRepository with `next/headers` faked and `redirect`
// throwing as the real one does, as app/admin/weeks/actions.test.ts drives the admin's. Which week offers which button
// is upcomingRows' (src/account-weeks.test.ts), what the repository writes and refuses is its contract's
// (src/adapters/week-credit-contract.ts), and what the page says after is ./page.test.ts's. These hold what each action
// does with them: the gate, the cutoff read at the request, the match against the week's button, and where the
// member is sent back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { cutoffInstant } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { redirectOf } from "../../screen-test-helpers";
import { skipWeek, unskipWeek } from "./actions";

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
    throw new Error("Skip and Unskip send no email");
  },
  getSessionSecret: () => services.secret,
}));

// Wednesday, February 3, 2027, noon in Cleveland. Upcoming weeks lists February 7 to April 25. February 7's cutoff,
// the end of Monday, February 1, has passed; February 14's is the end of Monday, February 8.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const PAST_CUTOFF = "2027-02-07";
const OPEN = "2027-02-14";
const WEEKS_PATH = "/account/weeks";
const DAY = 24 * 60 * 60_000;

let product: ProductWithOptions;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  product = addSupperClub(services.repo);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

type Subscriber = { memberId: string; subscriptionId: string };

/** A member with an active subscription whose first week is `firstWeek`, paid at signup. Not signed in. */
const subscriber = async (email: string, firstWeek = "2027-01-03"): Promise<Subscriber> => {
  const member = await services.repo.createMember({ email });
  const signup = await services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 4500,
    weeklyCents: 4500,
    pickupDate: firstWeek,
    consentText: "I agree to a weekly charge of $45.",
    consentAt: new Date("2026-12-01T17:00:00.000Z"),
  });
  await services.repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, new Date("2026-12-01T17:00:05.000Z"));
  return { memberId: member.id, subscriptionId: signup.subscriptionId };
};

const signIn = (memberId: string): void => {
  request.current.cookies.ocf_session = signSession({ subjectId: memberId, expiresAt: new Date(NOW.getTime() + DAY).toISOString() }, services.secret);
};

/** Ada, subscribed and signed in. */
const ada = async (firstWeek?: string): Promise<Subscriber> => {
  const found = await subscriber("ada@example.com", firstWeek);
  signIn(found.memberId);
  return found;
};

const skippedOf = async (subscriptionId: string) => (await services.repo.listMemberWeeks(subscriptionId)).skipped;

/** A redirect's path and query, so a test does not depend on the order the parameters are written in. */
const landing = (url: string) => {
  const parsed = new URL(url, "http://haul.test");
  return { path: parsed.pathname, query: Object.fromEntries(parsed.searchParams) };
};

const CUTOFF_NOTICE = { path: WEEKS_PATH, query: { error: "cutoff" } };

describe("AC1 (issue 137) — skipWeek", () => {
  it("AC1: a Coming week before its cutoff is skipped: its skipped row is stored, and the member goes back to Upcoming weeks", async () => {
    const { subscriptionId } = await ada();
    await expect(redirectOf(skipWeek(form({ week: OPEN })))).resolves.toBe(WEEKS_PATH);
    expect(await skippedOf(subscriptionId)).toEqual([OPEN]);
  });

  it.each([
    ["skipWeek", skipWeek, async () => {}],
    [
      "unskipWeek",
      unskipWeek,
      async (subscriptionId: string) => {
        await services.repo.skipWeek(subscriptionId, OPEN);
      },
    ],
  ] as const)("AC1: %s writes as the signed-in member, so the audit trigger names them", async (_name, action, before) => {
    const { memberId, subscriptionId } = await ada();
    await before(subscriptionId);
    const withActor = vi.spyOn(services.repo, "withActor");
    await expect(redirectOf(action(form({ week: OPEN })))).resolves.toBe(WEEKS_PATH);
    expect(withActor).toHaveBeenCalledWith({ member: memberId }, expect.any(Function));
  });
});

describe("AC2 (issue 137) — unskipWeek", () => {
  it("AC2: a Skipped week before its cutoff is unskipped: its skipped row is deleted, and the member goes back to Upcoming weeks", async () => {
    const { subscriptionId } = await ada();
    await services.repo.skipWeek(subscriptionId, OPEN);
    await expect(redirectOf(unskipWeek(form({ week: OPEN })))).resolves.toBe(WEEKS_PATH);
    expect(await skippedOf(subscriptionId)).toEqual([]);
  });
});

describe("AC3 (issue 137) — the cutoff, read at the request", () => {
  it("AC3: a skip for a Coming week whose cutoff has passed goes back with the cutoff Notice, and stores nothing", async () => {
    const { subscriptionId } = await ada();
    await expect(redirectOf(skipWeek(form({ week: PAST_CUTOFF }))).then(landing)).resolves.toEqual(CUTOFF_NOTICE);
    expect(await skippedOf(subscriptionId)).toEqual([]);
  });

  it("AC3: an unskip for a Skipped week whose cutoff has passed goes back with the cutoff Notice, and the skip stays", async () => {
    const { subscriptionId } = await ada();
    await services.repo.skipWeek(subscriptionId, PAST_CUTOFF);
    await expect(redirectOf(unskipWeek(form({ week: PAST_CUTOFF }))).then(landing)).resolves.toEqual(CUTOFF_NOTICE);
    expect(await skippedOf(subscriptionId)).toEqual([PAST_CUTOFF]);
  });

  it.each([
    ["Paid", PAST_CUTOFF, (subscriptionId: string) => services.repo.addLedgerRow(subscriptionId, PAST_CUTOFF, "paid", 4500)],
    ["no longer listed", "2027-01-24", async () => {}],
  ] as const)("AC3: a skip for any week past its cutoff gets the Notice, whatever the week: %s", async (_what, week, before) => {
    const { subscriptionId } = await ada();
    await before(subscriptionId);
    await expect(redirectOf(skipWeek(form({ week }))).then(landing)).resolves.toEqual(CUTOFF_NOTICE);
    expect(await skippedOf(subscriptionId)).toEqual([]);
  });

  it("AC3: the cutoff is the clock's at the request: a week open when the page was drawn is refused once its cutoff has come", async () => {
    const { memberId, subscriptionId } = await ada();
    vi.setSystemTime(cutoffInstant(product, OPEN));
    request.current.cookies.ocf_session = signSession({ subjectId: memberId, expiresAt: new Date(Date.now() + DAY).toISOString() }, services.secret);
    await expect(redirectOf(skipWeek(form({ week: OPEN }))).then(landing)).resolves.toEqual(CUTOFF_NOTICE);
    expect(await skippedOf(subscriptionId)).toEqual([]);
  });
});

describe("AC4 (issue 137) — the refusals go back silently", () => {
  it("AC4: a skip for a Paid week before its cutoff goes back with no Notice and stores nothing", async () => {
    const { subscriptionId } = await ada();
    await services.repo.addLedgerRow(subscriptionId, OPEN, "paid", 4500);
    await expect(redirectOf(skipWeek(form({ week: OPEN })))).resolves.toBe(WEEKS_PATH);
    expect(await skippedOf(subscriptionId)).toEqual([]);
  });

  it("AC4: an unskip for a week with no skipped row goes back with no Notice", async () => {
    const { subscriptionId } = await ada();
    await expect(redirectOf(unskipWeek(form({ week: OPEN })))).resolves.toBe(WEEKS_PATH);
    expect(await skippedOf(subscriptionId)).toEqual([]);
  });

  it.each([
    ["after the 12 listed", "2027-06-06"],
    ["not a Sunday", "2027-02-15"],
  ])("AC4: a skip for a week before its cutoff that is not listed (%s) goes back with no Notice and stores nothing", async (_what, week) => {
    const { subscriptionId } = await ada();
    await expect(redirectOf(skipWeek(form({ week })))).resolves.toBe(WEEKS_PATH);
    expect(await skippedOf(subscriptionId)).toEqual([]);
  });

  it("AC4: a week before the member's first week is not one of theirs: back with no Notice, nothing stored", async () => {
    const { subscriptionId } = await ada("2027-03-07");
    await expect(redirectOf(skipWeek(form({ week: OPEN })))).resolves.toBe(WEEKS_PATH);
    expect(await skippedOf(subscriptionId)).toEqual([]);
  });

  it.each([
    ["no real date", { week: "2027-02-31" }],
    ["words", { week: "next week" }],
    ["empty", { week: "" }],
    ["missing", {}],
  ])("AC4: a form whose week is %s goes back with no Notice and stores nothing", async (_what, fields: Record<string, string>) => {
    const { subscriptionId } = await ada();
    await expect(redirectOf(skipWeek(form(fields)))).resolves.toBe(WEEKS_PATH);
    expect(await skippedOf(subscriptionId)).toEqual([]);
  });

  it("AC4: signed out, a skip is sent to sign in and stores nothing", async () => {
    const { subscriptionId } = await subscriber("ada@example.com");
    await expect(redirectOf(skipWeek(form({ week: OPEN })))).resolves.toBe("/sign-in");
    expect(await skippedOf(subscriptionId)).toEqual([]);
  });

  it("AC4: the subscription skipped is the signed-in member's own: a form naming another's is not read", async () => {
    const grace = await subscriber("grace@example.com");
    const { subscriptionId } = await ada();
    await expect(redirectOf(skipWeek(form({ week: OPEN, subscriptionId: grace.subscriptionId })))).resolves.toBe(WEEKS_PATH);
    expect(await skippedOf(subscriptionId)).toEqual([OPEN]);
    expect(await skippedOf(grace.subscriptionId)).toEqual([]);
  });
});

describe("AC5 (issue 137) — a Week credit week", () => {
  it("AC5: a Week credit week before its cutoff can be skipped: its skipped row is stored", async () => {
    // February 7 paid, then closed: its week credit lands on February 14.
    const { subscriptionId } = await ada();
    await services.repo.addLedgerRow(subscriptionId, PAST_CUTOFF, "paid", 4500);
    await services.repo.closePickupWeek(product.id, PAST_CUTOFF, null, new Date("2027-02-02T15:00:00.000Z"));
    await expect(redirectOf(skipWeek(form({ week: OPEN })))).resolves.toBe(WEEKS_PATH);
    expect(await skippedOf(subscriptionId)).toEqual([OPEN]);
  });
});
