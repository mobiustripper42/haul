// Issue 139: the member's cancel, `cancelSubscription`, through an InMemoryRepository with `next/headers` faked and
// `redirect` throwing as the real one does, as app/account/weeks/actions.test.ts drives Skip. What a cancel writes, and
// that a second one writes nothing, is the repository contract's (src/adapters/signup-contract.ts); who is let in is
// requireSubscriber's. These hold what the action does with them: the subscription it acts on, the time it passes,
// that it checks no cutoff, the write as the member, and where the member lands.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { redirectOf } from "../../screen-test-helpers";
import { cancelSubscription } from "./actions";

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
    throw new Error("a cancel sends no email");
  },
  getSessionSecret: () => services.secret,
}));

// Wednesday, February 3, 2027, noon in Cleveland. February 7's cutoff, the end of Monday, February 1, has passed.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const PAST_CUTOFF = "2027-02-07";
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

const form = (fields: Record<string, string> = {}): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

type Subscriber = { memberId: string; subscriptionId: string };

/** A member with an active subscription paid for January 3. Not signed in. */
const subscriber = async (email: string): Promise<Subscriber> => {
  const member = await services.repo.createMember({ email });
  const signup = await services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 4500,
    weeklyCents: 4500,
    pickupDate: "2027-01-03",
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
const ada = async (): Promise<Subscriber> => {
  const found = await subscriber("ada@example.com");
  signIn(found.memberId);
  return found;
};

/** The member's subscription's status and the time of its cancel. */
const statusOf = async (memberId: string) => {
  const found = await services.repo.findMemberSubscription(memberId, product.id);
  return found && { status: found.status, cancelledAt: found.cancelledAt };
};

describe("AC1 (issue 139) — the member confirms", () => {
  it("AC1: the subscription is cancelled at the time of the request, and the member lands on /account", async () => {
    const { memberId } = await ada();
    await expect(redirectOf(cancelSubscription(form()))).resolves.toBe("/account");
    expect(await statusOf(memberId)).toEqual({ status: "cancelled", cancelledAt: NOW });
  });

  it("AC1: it writes as the signed-in member, so the audit trigger names them", async () => {
    const { memberId } = await ada();
    const withActor = vi.spyOn(services.repo, "withActor");
    await expect(redirectOf(cancelSubscription(form()))).resolves.toBe("/account");
    expect(withActor).toHaveBeenCalledWith({ member: memberId }, expect.any(Function));
  });
});

describe("AC3 (issue 139) — no cutoff refuses a cancel", () => {
  it("AC3: after a charged week's cutoff, the cancel goes through and the week stays paid", async () => {
    const { memberId, subscriptionId } = await ada();
    await services.repo.addLedgerRow(subscriptionId, PAST_CUTOFF, "paid", 4500);
    await expect(redirectOf(cancelSubscription(form()))).resolves.toBe("/account");
    expect(await statusOf(memberId)).toEqual({ status: "cancelled", cancelledAt: NOW });
    expect((await services.repo.listMemberWeeks(subscriptionId)).paid.map((row) => row.weekOf)).toEqual(["2027-01-03", PAST_CUTOFF]);
  });
});

describe("AC10 (issue 139) — a cancel already made", () => {
  it("AC10: a second cancel, a double submit or a stale form, lands on /account with no error, and the first cancel's time stands", async () => {
    const { memberId, subscriptionId } = await ada();
    const earlier = new Date(NOW.getTime() - DAY);
    await services.repo.cancelSubscription(subscriptionId, earlier);
    await expect(redirectOf(cancelSubscription(form()))).resolves.toBe("/account");
    expect(await statusOf(memberId)).toEqual({ status: "cancelled", cancelledAt: earlier });
  });
});

describe("AC11 (issue 139) — the subscription cancelled is the member's own", () => {
  it("AC11: a form posting another member's subscription id is not read: the signed-in member's is cancelled, the other stays active", async () => {
    const grace = await subscriber("grace@example.com");
    const { memberId } = await ada();
    await expect(redirectOf(cancelSubscription(form({ subscription: grace.subscriptionId, subscriptionId: grace.subscriptionId })))).resolves.toBe("/account");
    expect(await statusOf(memberId)).toEqual({ status: "cancelled", cancelledAt: NOW });
    expect(await statusOf(grace.memberId)).toEqual({ status: "active", cancelledAt: null });
  });

  it("AC11: signed out, a cancel is sent to sign in and cancels nothing", async () => {
    const { memberId } = await subscriber("ada@example.com");
    await expect(redirectOf(cancelSubscription(form()))).resolves.toBe("/sign-in");
    expect(await services.repo.findActiveSubscription(memberId, product.id)).not.toBeNull();
  });
});
