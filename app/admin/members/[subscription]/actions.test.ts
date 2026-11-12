// Issue 139: an admin's cancel for a member, `cancelForMember`, through an InMemoryRepository with `next/headers` faked
// and `redirect` throwing as the real one does, as app/admin/weeks/actions.test.ts drives the weeks screen's. What a
// cancel writes, and that a second one writes nothing, is the repository contract's (src/adapters/signup-contract.ts);
// who counts as an admin is app/session.test.ts's. These hold what the action does with them: the subscription posted,
// the time it passes, the write as the admin, and where the admin lands.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Role } from "@core/members.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../../../next-headers-fake";
import { redirectOf } from "../../../screen-test-helpers";
import { addSupperClub, pendingSignup } from "../../subscribers-fixture";
import { cancelForMember } from "./actions";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("a cancel sends no email");
  },
  getSessionSecret: () => services.secret,
}));

const NOW = new Date("2027-02-03T17:00:00.000Z");
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

async function signInAs(role: Role): Promise<string> {
  const member = await services.repo.createMember({ email: "lenny@example.com", role });
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(Date.now() + DAY).toISOString() }, services.secret);
  return member.id;
}

/** Rosa with an active subscription paid for January 3: her member id and the subscription's. */
const rosa = async (): Promise<{ memberId: string; subscriptionId: string }> => {
  const signup = await pendingSignup(services.repo, product, { email: "rosa@example.com", firstName: "Rosa", lastName: "Bennett" }, ["2 people", "Vegan"]);
  await services.repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, new Date("2026-12-01T17:00:05.000Z"));
  const member = await services.repo.findMemberByEmail("rosa@example.com");
  return { memberId: member?.id ?? "no member", subscriptionId: signup.subscriptionId };
};

const form = (subscription: string): FormData => {
  const data = new FormData();
  data.set("subscription", subscription);
  return data;
};

const statusOf = async (memberId: string) => {
  const found = await services.repo.findMemberSubscription(memberId, product.id);
  return found && { status: found.status, cancelledAt: found.cancelledAt };
};

describe("AC8 (issue 139) — the admin confirms", () => {
  it("AC8: the subscription posted is cancelled at the time of the request, and the admin lands on its member page, the confirm closed", async () => {
    await signInAs("admin");
    const { memberId, subscriptionId } = await rosa();
    await expect(redirectOf(cancelForMember(form(subscriptionId)))).resolves.toBe(`/admin/members/${subscriptionId}`);
    expect(await statusOf(memberId)).toEqual({ status: "cancelled", cancelledAt: NOW });
  });

  it("AC8: it writes as the admin, so the audit row names the admin's member id as who acted", async () => {
    const adminId = await signInAs("admin");
    const { subscriptionId } = await rosa();
    const withActor = vi.spyOn(services.repo, "withActor");
    await expect(redirectOf(cancelForMember(form(subscriptionId)))).resolves.toBe(`/admin/members/${subscriptionId}`);
    expect(withActor).toHaveBeenCalledWith({ member: adminId }, expect.any(Function));
  });
});

describe("AC10 (issue 139) — a cancel already made", () => {
  it("AC10: a second cancel lands on the member page with no error, and the first cancel's time stands", async () => {
    await signInAs("admin");
    const { memberId, subscriptionId } = await rosa();
    const earlier = new Date(NOW.getTime() - DAY);
    await services.repo.cancelSubscription(subscriptionId, earlier);
    await expect(redirectOf(cancelForMember(form(subscriptionId)))).resolves.toBe(`/admin/members/${subscriptionId}`);
    expect(await statusOf(memberId)).toEqual({ status: "cancelled", cancelledAt: earlier });
  });
});

describe("AC11 (issue 139) — only an admin runs the admin cancel", () => {
  it("AC11: a signed-in member whose role is not admin goes to /, and nothing is cancelled", async () => {
    await signInAs("member");
    const { memberId, subscriptionId } = await rosa();
    await expect(redirectOf(cancelForMember(form(subscriptionId)))).resolves.toBe("/");
    expect(await services.repo.findActiveSubscription(memberId, product.id)).not.toBeNull();
  });

  it("AC11: a signed-out visitor is sent to /sign-in, and nothing is cancelled", async () => {
    const { memberId, subscriptionId } = await rosa();
    await expect(redirectOf(cancelForMember(form(subscriptionId)))).resolves.toBe("/sign-in");
    expect(await services.repo.findActiveSubscription(memberId, product.id)).not.toBeNull();
  });
});
