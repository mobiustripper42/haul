// Issue 145: the member's card save, `saveCard`, through an InMemoryRepository and FakePayments with `next/headers`
// faked and `redirect` throwing as the real one does, as app/account/cancel/actions.test.ts drives the cancel. What a
// save charges, keeps and records is src/update-card.test.ts's; who is let in is requireSubscriber's. These hold what the
// action does with it: the subscription and the card it acts on, the outcome it carries to the page, and the events the
// entry is declared to record (app/audit-entry-points.ts): "card_declined" and "charge_outcome_unknown".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "@core/adapters/fake-email.js";
import { FakePayments } from "@core/adapters/fake-payments.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { PaymentsError, type Card } from "@core/ports/payments.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { redirectOf } from "../../screen-test-helpers";
import { saveCard } from "./actions";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  payments: undefined as unknown as import("@core/adapters/fake-payments.js").FakePayments,
  email: undefined as unknown as import("@core/adapters/fake-email.js").FakeEmail,
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
  getPayments: () => services.payments,
  getEmail: () => services.email,
  getSiteUrl: () => "https://members.example.test",
  getSessionSecret: () => services.secret,
}));

// Wednesday, February 3, 2027, noon in Cleveland: the cutoffs of January's weeks have passed.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const JAN_24 = "2027-01-24";
const JAN_31 = "2027-01-31";
const SIGNED_UP_AT = new Date("2026-12-01T17:00:00.000Z");
const OLD_CARD: Card = { id: "ccof:old-card", brand: "MASTERCARD", last4: "4444", expMonth: 1, expYear: 2029 };

let product: ProductWithOptions;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  services.payments = new FakePayments();
  services.email = new FakeEmail();
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

/** A member with a Square customer and an active subscription paid for January 3 at $45, OLD_CARD bound. Not signed in. */
const subscriber = async (email: string): Promise<Subscriber> => {
  const member = await services.repo.createMember({ email });
  const customerId = services.payments.addCustomer({ email, createdAt: SIGNED_UP_AT, updatedAt: SIGNED_UP_AT }).id;
  await services.repo.setMemberSquareCustomer(member.id, customerId);
  const signup = await services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 4500,
    weeklyCents: 4500,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $45.",
    consentAt: SIGNED_UP_AT,
  });
  await services.repo.saveSubscriptionCard(signup.subscriptionId, OLD_CARD);
  await services.repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, SIGNED_UP_AT);
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

const declined = (who: Subscriber, weekOf: string) => services.repo.addLedgerRow(who.subscriptionId, weekOf, "declined", 4500);

/** Where a save landed: its path, its state and the ledger ids it carries, however the query writes them. */
const landing = (url: string) => {
  const parsed = new URL(url, "https://members.example.test");
  return {
    path: parsed.pathname,
    state: parsed.searchParams.get("state"),
    rows: (parsed.searchParams.get("rows") ?? "").split(",").filter(Boolean).sort(),
  };
};

const refusal = (): PaymentsError => new PaymentsError({ status: 402, category: "PAYMENT_METHOD_ERROR", code: "CARD_DECLINED", detail: "Card declined." });

describe("AC4 — a save that pays the declined weeks", () => {
  it("AC4: the member lands on /account/card with state retried and the ledger ids that paid", async () => {
    const who = await ada();
    const first = await declined(who, JAN_24);
    const second = await declined(who, JAN_31);
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card" })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "retried", rows: [first, second].sort() });
  });

  it("AC4: it saves the card the form posts, on the signed-in member's subscription, whatever else the form posts", async () => {
    const grace = await subscriber("grace@example.com");
    const gracesRow = await declined(grace, JAN_24);
    const who = await ada();
    const mine = await declined(who, JAN_24);
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card", subscription: grace.subscriptionId, subscriptionId: grace.subscriptionId })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "retried", rows: [mine] });
    expect(services.payments.charges.map((charge) => charge.referenceId)).toEqual([mine]);
    expect((await services.repo.listDeclinedCharges(grace.subscriptionId)).map((row) => row.ledgerId)).toEqual([gracesRow]);
  });
});

describe("AC5, AC8 — a save that fails", () => {
  it("AC5: a card Square refuses lands on /account/card with state declined, and records card_declined", async () => {
    const who = await ada();
    await declined(who, JAN_24);
    services.payments.failNext(refusal());
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:refused" })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "declined", rows: [] });
    expect(services.repo.events().map((event) => event.kind)).toEqual(["card_declined"]);
  });

  it("AC8: a charge with no answer lands on state declined too, and records charge_outcome_unknown", async () => {
    const who = await ada();
    await declined(who, JAN_24);
    vi.spyOn(services.payments, "charge")
      .mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"))
      .mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card" })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "declined", rows: [] });
    expect(services.repo.events().map((event) => event.kind)).toEqual(["charge_outcome_unknown"]);
  });
});

describe("AC2 — who can save", () => {
  it("AC2: a member whose subscription is cancelled is sent to /account before anything reaches Square", async () => {
    const who = await ada();
    await declined(who, JAN_24);
    await services.repo.cancelSubscription(who.subscriptionId, NOW);
    const save = vi.spyOn(services.payments, "saveCard");
    await expect(redirectOf(saveCard(form({ sourceId: "cnon:new-card" })))).resolves.toBe("/account");
    expect(save).not.toHaveBeenCalled();
    expect(services.payments.charges).toEqual([]);
  });
});
