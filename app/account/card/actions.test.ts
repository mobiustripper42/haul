// Issue 145: the member's card save, `saveCard`, and its Try again, `retryCard`, through an InMemoryRepository and
// FakePayments with `next/headers` faked and `redirect` throwing as the real one does, as
// app/account/cancel/actions.test.ts drives the cancel. What a save or a Try again charges, keeps and records is
// src/update-card.test.ts's; who is let in is requireSubscriber's. These hold what each action does with it: the
// subscription and the card it acts on, the outcome it carries to the page, and the events each entry is declared to
// record (app/audit-entry-points.ts): "card_declined" and "charge_outcome_unknown".
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
import { retryCard, saveCard } from "./actions";

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

/** A member with a Square customer and an active subscription paid for January 3 at $45, OLD_CARD on file. Not signed in. */
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
  await services.repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, SIGNED_UP_AT, OLD_CARD);
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

/** Where a save landed: its path, its state and the ledger id it carries, however the query writes them. */
const landing = (url: string) => {
  const parsed = new URL(url, "https://members.example.test");
  return { path: parsed.pathname, state: parsed.searchParams.get("state"), row: parsed.searchParams.get("row") };
};

const noAnswer = () => new DOMException("The operation timed out.", "TimeoutError");

/** The save of a new card whose charge got no answer: the declined row is claimed and left with its token out. Its id, and where the save landed. */
const leftOut = async (who: Subscriber): Promise<{ row: string; url: string }> => {
  const row = await declined(who, JAN_24);
  vi.spyOn(services.payments, "charge").mockRejectedValueOnce(noAnswer()).mockRejectedValueOnce(noAnswer());
  const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card" })));
  return { row, url };
};

const refusal = (): PaymentsError => new PaymentsError({ status: 402, category: "PAYMENT_METHOD_ERROR", code: "CARD_DECLINED", detail: "Card declined." });

describe("AC3, AC6 — a save that is done", () => {
  it("AC6: a save that pays the declined week lands on /account/card with state paid and that row's ledger id", async () => {
    const who = await ada();
    const row = await declined(who, JAN_24);
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card" })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "paid", row });
  });

  it("AC3: a save with nothing owed lands on state saved, with no row", async () => {
    await ada();
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card" })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "saved", row: null });
  });

  it("it saves the card the form posts, on the signed-in member's subscription, whatever else the form posts", async () => {
    const grace = await subscriber("grace@example.com");
    const gracesRow = await declined(grace, JAN_31);
    const who = await ada();
    const mine = await declined(who, JAN_24);
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card", subscription: grace.subscriptionId, subscriptionId: grace.subscriptionId })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "paid", row: mine });
    expect(services.payments.charges.map((charge) => charge.referenceId)).toEqual([mine]);
    expect((await services.repo.listDeclinedCharges(grace.subscriptionId)).map((row) => row.ledgerId)).toEqual([gracesRow]);
  });
});

describe("AC4, AC7, AC8, AC10, AC11 — a save that is not done", () => {
  it("AC4: a card Square refuses to save lands on /account/card with state declined, and records card_declined", async () => {
    await ada();
    services.payments.failNext(refusal());
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:refused" })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "declined", row: null });
    expect(services.repo.events().map((event) => event.kind)).toEqual(["card_declined"]);
  });

  it("AC7: the declined week's charge declined lands on state declined too, and records card_declined", async () => {
    const who = await ada();
    await declined(who, JAN_24);
    vi.spyOn(services.payments, "charge").mockResolvedValueOnce({ outcome: "declined", code: "INSUFFICIENT_FUNDS" });
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card" })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "declined", row: null });
    expect(services.repo.events().map((event) => event.kind)).toEqual(["card_declined"]);
  });

  it("AC8: a charge with no answer lands on state unknown, and records charge_outcome_unknown", async () => {
    const who = await ada();
    const { url } = await leftOut(who);
    expect(landing(url)).toEqual({ path: "/account/card", state: "unknown", row: null });
    expect(services.repo.events().map((event) => event.kind)).toEqual(["charge_outcome_unknown"]);
  });

  it("AC10: a save while the subscription holds a pending row lands on state unknown: nothing charged, the card on file kept, nothing recorded", async () => {
    const who = await ada();
    await services.repo.addLedgerRow(who.subscriptionId, JAN_31, "pending", 4500);
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card" })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "unknown", row: null });
    expect(services.payments.charges).toEqual([]);
    expect(await services.repo.findSubscriptionCard(who.subscriptionId)).toEqual({ brand: OLD_CARD.brand, last4: OLD_CARD.last4 });
    expect(services.repo.events()).toEqual([]);
  });

  it("AC11: a failure before any charge lands on state error, and records nothing", async () => {
    await ada();
    services.payments.failNext(new PaymentsError({ status: 500, category: "API_ERROR", code: "INTERNAL_SERVER_ERROR", detail: "Square fell over." }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card" })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "error", row: null });
    expect(services.repo.events()).toEqual([]);
  });
});

describe("AC9, AC11 — Try again", () => {
  it("AC9: Try again on the row whose token is out lands on state paid with its ledger id, one charge made and its card saved once", async () => {
    const who = await ada();
    const { row } = await leftOut(who);
    const save = vi.spyOn(services.payments, "saveCard");
    const url = await redirectOf(retryCard());
    expect(landing(url)).toEqual({ path: "/account/card", state: "paid", row });
    expect(save.mock.calls.map(([input]) => input.sourceId)).toEqual([services.payments.charges[0]?.result.paymentId]);
    expect(services.payments.charges.map((charge) => [charge.referenceId, charge.result.outcome])).toEqual([[row, "paid"]]);
  });

  it("AC9: it settles the signed-in member's row, not another member's", async () => {
    const grace = await subscriber("grace@example.com");
    const gracesRow = await services.repo.addLedgerRow(grace.subscriptionId, JAN_31, "pending", 4500);
    const who = await ada();
    const { row } = await leftOut(who);
    await redirectOf(retryCard());
    expect(services.payments.charges.map((charge) => charge.referenceId)).toEqual([row]);
    expect((await services.repo.findPendingCharge(grace.subscriptionId))?.ledgerId).toBe(gracesRow);
  });

  it("AC11: a Try again whose lookup fails lands on state error, and records nothing more", async () => {
    const who = await ada();
    await leftOut(who);
    vi.spyOn(services.payments, "findPaymentByReference").mockRejectedValueOnce(new Error("Square's lookup failed"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const url = await redirectOf(retryCard());
    expect(landing(url)).toEqual({ path: "/account/card", state: "error", row: null });
    expect(services.repo.events().map((event) => event.kind)).toEqual(["charge_outcome_unknown"]);
  });
});

describe("AC10, AC12 (issue 254) — paid, and the card not saved", () => {
  it("AC10: a save whose charge pays and whose card Square refuses to save lands on state paidNoCard with the row's ledger id, and records card_not_saved", async () => {
    const who = await ada();
    const row = await declined(who, JAN_24);
    vi.spyOn(services.payments, "saveCard").mockRejectedValueOnce(refusal());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const url = await redirectOf(saveCard(form({ sourceId: "cnon:new-card" })));
    expect(landing(url)).toEqual({ path: "/account/card", state: "paidNoCard", row });
    expect(services.repo.events().map((event) => event.kind)).toEqual(["card_not_saved"]);
  });

  it("AC12: a Try again whose charge pays and whose card cannot be saved lands on state paidNoCard with the row's ledger id, and records card_not_saved", async () => {
    const who = await ada();
    const { row } = await leftOut(who);
    vi.spyOn(services.payments, "saveCard").mockRejectedValueOnce(refusal());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const url = await redirectOf(retryCard());
    expect(landing(url)).toEqual({ path: "/account/card", state: "paidNoCard", row });
    expect(services.repo.events().map((event) => event.kind)).toEqual(["charge_outcome_unknown", "card_not_saved"]);
  });

  it("AC12: a Try again whose token is dead lands on state error, with no row", async () => {
    const who = await ada();
    await leftOut(who);
    vi.spyOn(services.payments, "charge").mockRejectedValueOnce(
      new PaymentsError({ status: 400, category: "INVALID_REQUEST_ERROR", code: "CARD_TOKEN_EXPIRED", detail: "The token expired." }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const url = await redirectOf(retryCard());
    expect(landing(url)).toEqual({ path: "/account/card", state: "error", row: null });
    expect((await services.repo.listDeclinedCharges(who.subscriptionId)).map((found) => found.attempt)).toEqual([2]);
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

  it("AC2: Try again on a cancelled subscription is sent to /account before anything reaches Square", async () => {
    const who = await ada();
    await services.repo.addLedgerRow(who.subscriptionId, JAN_31, "pending", 4500);
    await services.repo.cancelSubscription(who.subscriptionId, NOW);
    const lookup = vi.spyOn(services.payments, "findPaymentByReference");
    const charge = vi.spyOn(services.payments, "charge");
    await expect(redirectOf(retryCard())).resolves.toBe("/account");
    expect(lookup).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });
});
