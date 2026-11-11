// Issue 155, AC1: the gate the account pages share, with `next/headers` faked and the composition root mocked, as
// app/account/page.test.ts renders /account. A signed-in request is an ocf_session cookie for a member in an
// InMemoryRepository; a subscription is the rows a paid signup leaves. Who counts as signed in is
// app/session.test.ts's; which subscription is found is findSignupConfirmation's. Each page's test checks one case
// let in and one sent away.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Member } from "@core/members.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { addSupperClub } from "../admin/subscribers-fixture";
import { emptyRequest } from "../next-headers-fake";
import { redirectOf } from "../screen-test-helpers";
import { requireSubscriber } from "./subscriber";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("the gate has no reason to send email");
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
  vi.useRealTimers();
});

const signIn = (member: Member): void => {
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(Date.now() + DAY).toISOString() }, services.secret);
};

const ada = (): Promise<Member> => services.repo.createMember({ email: "ada@example.com" });

const signup = (member: Member): Promise<PendingSignup> =>
  services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 4500,
    weeklyCents: 4500,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $45.",
    consentAt: new Date("2026-12-01T17:00:00.000Z"),
  });

describe("AC1 (issue 155) — requireSubscriber", () => {
  it("AC1: a signed-out visitor is sent to /sign-in", async () => {
    await expect(redirectOf(requireSubscriber())).resolves.toBe("/sign-in");
  });

  it.each([
    ["no subscription at all", async () => {}],
    ["a pending signup", async (member: Member) => void (await signup(member))],
    ["a declined first charge", async (member: Member) => services.repo.recordSignupDecline((await signup(member)).ledgerId)],
  ])("AC1: a signed-in member with %s is sent to /supper-club", async (_what, arrange) => {
    const member = await ada();
    await arrange(member);
    signIn(member);
    await expect(redirectOf(requireSubscriber())).resolves.toBe("/supper-club");
  });

  it("AC1: a member with an active, paid subscription is let in, with the member, the Supper Club and the subscription", async () => {
    const member = await ada();
    const rows = await signup(member);
    await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
    signIn(member);
    expect(await requireSubscriber()).toMatchObject({
      member: { id: member.id },
      product: { id: product.id },
      confirmation: { subscriptionId: rows.subscriptionId, pickupDate: "2027-01-03" },
    });
  });
});
