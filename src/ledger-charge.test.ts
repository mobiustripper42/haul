// Issue 254: the three steps signup, the card update and the charge run share: sendCharge's rule for a refused charge,
// settlePaid (the card saved from the payment, then the one confirm) and takeCharge (a first charge, and a submit over a
// charge that is out). Their callers' tests take one case each way through them. Which errors are a refused charge is
// isRefusedCharge's (src/ports/payments-refused-charge.test.ts), a dead token's being one; what each write does, and which
// charge it names, is the repository's (src/adapters/signup-contract.ts, charge-run-contract.ts). The ten minutes, what
// takeCharge does with each write's answer, and AC23's interleavings are owned here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { FakePayments } from "./adapters/fake-payments.js";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { runCharges } from "./charge-run.js";
import { sha256Key } from "./customer-match.js";
import { sendCharge, settlePaid, takeCharge } from "./ledger-charge.js";
import { IdempotencyKeyReusedError, PaymentsError, type Card } from "./ports/payments.js";
import type { Actor, PendingSignup, PendingSignupInput, Repository } from "./ports/repository.js";

const SOURCE = "cnon:card-nonce-ok";
const OTHER = "cnon:another-card";
const PAID_AT = new Date("2026-11-06T15:00:05.000Z");

let repo: InMemoryRepository;
let payments: FakePayments;
let memberId: string;
let productId: string;
let customerId: string;
let row: PendingSignup;
let signupInput: PendingSignupInput;

beforeEach(async () => {
  await freshSignup();
});

/** A new repository and a new Square, holding one member's signup for January 3 at 5000, saved and not yet charged. */
async function freshSignup(): Promise<void> {
  repo = new InMemoryRepository();
  payments = new FakePayments();
  const product = repo.addProduct({
    name: "Supper Club",
    cap: 50,
    firstPickupDate: "2027-01-03",
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes: [{ name: "How many people?", position: 1, options: [{ name: "2 people", priceCents: 5000, position: 1 }] }],
  });
  productId = product.id;
  memberId = (await repo.createMember({ email: "ada@example.com" })).id;
  customerId = payments.addCustomer({ email: "ada@example.com", createdAt: PAID_AT, updatedAt: PAID_AT }).id;
  await repo.setMemberSquareCustomer(memberId, customerId);
  signupInput = {
    memberId,
    productId,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no option"])),
    firstChargeCents: 5000,
    weeklyCents: 5000,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $50.",
    consentAt: PAID_AT,
  };
  row = await repo.savePendingSignup(signupInput);
}

afterEach(() => {
  vi.restoreAllMocks();
});

const actor = (): Actor => ({ member: memberId });
const paymentsError = (code: string, category = "INVALID_REQUEST_ERROR") => new PaymentsError({ status: 400, category, code, detail: "Square's text" });
/** The two kinds of refused charge: a dead token, and a request Square refuses for any other reason. */
const REFUSALS: [string, () => PaymentsError][] = [
  ["a dead token", () => paymentsError("CARD_TOKEN_USED")],
  ["another refusal", () => paymentsError("INVALID_VALUE")],
];
const noAnswer = (): Error => new DOMException("The operation timed out.", "TimeoutError");
const onFile = () => repo.findSubscriptionCard(row.subscriptionId);

describe("sendCharge (issue 254)", () => {
  const send = () => sendCharge(payments, { row, sourceId: SOURCE, customerId, customerInitiated: true });

  it.each([true, false])("AC16: the request carries the source and who started it: customerInitiated %s, resent unchanged when the first gets no answer", async (customerInitiated) => {
    const charge = vi.spyOn(payments, "charge").mockRejectedValueOnce(noAnswer()).mockResolvedValueOnce({ outcome: "paid", paymentId: "PAYMENT_1" });
    expect(await sendCharge(payments, { row, sourceId: SOURCE, customerId, customerInitiated })).toEqual({ outcome: "paid", paymentId: "PAYMENT_1" });
    const request = { customerId, sourceId: SOURCE, amountCents: 5000, idempotencyKey: `${row.ledgerId}:1`, referenceId: row.ledgerId, customerInitiated };
    expect(charge.mock.calls).toEqual([[request], [request]]);
  });

  it.each(REFUSALS)("AC8, AC21: %s is thrown at once, not resent", async (_what, refused) => {
    const error = refused();
    const charge = vi.spyOn(payments, "charge").mockRejectedValue(error);
    await expect(send()).rejects.toBe(error);
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it.each(REFUSALS)("AC8, AC21: any other failure and then %s throws the first failure: the first send may be what used the token", async (_what, refused) => {
    const first = noAnswer();
    const charge = vi.spyOn(payments, "charge").mockRejectedValueOnce(first).mockRejectedValueOnce(refused());
    await expect(send()).rejects.toBe(first);
    expect(charge).toHaveBeenCalledTimes(2);
  });

  it("AC8, AC21: two failures that are not refusals throw the second, as before", async () => {
    const second = paymentsError("SERVICE_UNAVAILABLE", "API_ERROR");
    vi.spyOn(payments, "charge").mockRejectedValueOnce(noAnswer()).mockRejectedValueOnce(second);
    await expect(send()).rejects.toBe(second);
  });
});

describe("settlePaid (issue 254)", () => {
  /** The signup's token charged and paid; the payment's id. */
  const paid = async (): Promise<string> => {
    const result = await payments.charge({ customerId, sourceId: SOURCE, amountCents: 5000, idempotencyKey: `${row.ledgerId}:1`, referenceId: row.ledgerId, customerInitiated: true });
    return result.outcome === "paid" ? result.paymentId : "no payment";
  };
  const settle = (paymentId: string, amountCents = 5000) => settlePaid(repo, payments, actor(), { ledgerId: row.ledgerId, paymentId, amountCents, customerId, memberId, paidAt: PAID_AT });
  const active = () => repo.findActiveSubscription(memberId, productId);
  /** The save gets no card, whatever Square said. */
  const saveFails = (error: Error) => vi.spyOn(payments, "saveCard").mockRejectedValue(error);

  it("AC3: the card is saved from the payment, under the payment's SHA-256, and one confirm puts it on file and confirms the rows, as the actor", async () => {
    const paymentId = await paid();
    const save = vi.spyOn(payments, "saveCard");
    const confirm = vi.spyOn(repo, "confirmSignupRows");
    const withActor = vi.spyOn(repo, "withActor");
    expect(await settle(paymentId)).toEqual({ confirmed: "confirmed", cardSaved: true });
    expect(save.mock.calls).toStrictEqual([[{ customerId, sourceId: paymentId, idempotencyKey: sha256Key(paymentId) }]]);
    expect(confirm.mock.calls).toEqual([[row.ledgerId, paymentId, 5000, PAID_AT, payments.cards[0]]]);
    expect(withActor.mock.calls.map(([who]) => who)).toEqual([actor()]);
    expect(await active()).toEqual({ id: row.subscriptionId });
    expect(await onFile()).toEqual({ brand: "VISA", last4: "1111" });
    expect(repo.events()).toEqual([]);
  });

  it.each<[string, Error, { code?: string }]>([
    ["refused by Square", paymentsError("CVV_FAILURE", "PAYMENT_METHOD_ERROR"), { code: "CVV_FAILURE" }],
    ["failed by Square", paymentsError("SERVICE_UNAVAILABLE", "API_ERROR"), { code: "SERVICE_UNAVAILABLE" }],
    ["unanswered", noAnswer(), {}],
  ])("AC4: a save %s: the rows confirm with no card on file, and card_not_saved is recorded with the ledger and payment ids and the PaymentsError's code", async (_how, error, code) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const paymentId = await paid();
    saveFails(error);
    expect(await settle(paymentId)).toEqual({ confirmed: "confirmed", cardSaved: false });
    expect(await active()).toEqual({ id: row.subscriptionId });
    expect(await onFile()).toBeNull();
    expect(repo.events()).toEqual([{ kind: "card_not_saved", memberId, detail: { ledgerId: row.ledgerId, paymentId, ...code }, actor: actor() }]);
  });

  it("AC4: a failed save on rows already confirmed records nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const paymentId = await paid();
    await repo.confirmSignupRows(row.ledgerId, paymentId, 5000, PAID_AT);
    saveFails(paymentsError("CVV_FAILURE", "PAYMENT_METHOD_ERROR"));
    expect(await settle(paymentId)).toEqual({ confirmed: "already", cardSaved: false });
    expect(repo.events()).toEqual([]);
  });

  it("AC4: a failed save and an amount that is not the ledger's: mismatch, nothing confirmed and nothing recorded here", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const paymentId = await paid();
    saveFails(paymentsError("CVV_FAILURE", "PAYMENT_METHOD_ERROR"));
    expect(await settle(paymentId, 7000)).toMatchObject({ confirmed: "mismatch" });
    expect(await active()).toBeNull();
    expect(repo.events()).toEqual([]);
  });
});

describe("takeCharge (issue 254)", () => {
  const SENT_AT = new Date("2026-11-06T15:00:00.000Z");
  const MINUTE = 60_000;
  const TEN_MINUTES = 10 * MINUTE;
  /** The moment `ms` after the charge that is out was sent. */
  const after = (ms: number): Date => new Date(SENT_AT.getTime() + ms);

  type Row = Parameters<typeof takeCharge>[3]["row"];

  /** What the clock reads. */
  let now: Date;
  /** The row as the submit read it: its charge out since SENT_AT. */
  let read: Row;

  beforeEach(async () => {
    now = SENT_AT;
    expect(await repo.startSignupCharge(row.subscriptionId, SENT_AT)).toEqual({ amountCents: 5000, attempt: 1 });
    read = await outRow();
  });

  const found = () => repo.findPendingSignup(memberId, productId);
  /** The row's status, its attempt, and when its charge was sent. */
  const state = async () => {
    const held = await found();
    return held && [held.ledgerStatus, held.attempt, held.chargeSentAt];
  };
  const outRow = async (): Promise<Row> => {
    const held = await found();
    if (!held?.chargeSentAt) throw new Error("no charge is out on the row");
    return { ...held, chargeSentAt: held.chargeSentAt };
  };

  const take = (over: Partial<{ row: Row; first: boolean; sourceId: string; clock: () => Date }> = {}) =>
    takeCharge(repo, payments, actor(), { row: read, first: false, sourceId: OTHER, customerId, clock: () => now, ...over });
  const takeFirst = () => take({ first: true, sourceId: SOURCE });

  const request = (attempt: number, sourceId: string) => ({
    customerId,
    sourceId,
    amountCents: 5000,
    idempotencyKey: `${row.ledgerId}:${attempt}`,
    referenceId: row.ledgerId,
    customerInitiated: true,
  });
  /** The charge that is out reached Square, which took or declined it, and its answer was lost. */
  const firstReached = async (answer: "paid" | "declined"): Promise<void> => {
    if (answer === "declined") payments.declineCard(SOURCE, "GENERIC_DECLINE");
    expect((await payments.charge(request(1, SOURCE))).outcome).toBe(answer);
  };
  /** Another submit takes the charge over as the row stands, at `when`. */
  const anotherMarks = async (when: Date): Promise<void> => {
    const held = await outRow();
    expect(await repo.markChargeSent(held.ledgerId, held.attempt, held.chargeSentAt, when)).toEqual(when);
  };
  /** `other` runs while the first charge to `sourceId` is on its way. */
  const duringTheCharge = (other: () => Promise<unknown>) => {
    const real = payments.charge.bind(payments);
    return vi.spyOn(payments, "charge").mockImplementationOnce(async (input) => {
      await other();
      return real(input);
    });
  };
  const keysSent = (spy: { mock: { calls: Array<[{ idempotencyKey: string }]> } }) => [...new Set(spy.mock.calls.map(([input]) => input.idempotencyKey))];
  /** Who the writes were made as, each once. */
  const actorsOf = (spy: { mock: { calls: Array<[Actor, unknown]> } }): Actor[] =>
    [...new Set(spy.mock.calls.map(([who]) => JSON.stringify(who)))].map((who) => JSON.parse(who) as Actor);
  const keyOf = (attempt: number) => `${row.ledgerId}:${attempt}`;

  describe("a first charge", () => {
    it("AC1: it is sent at once, with no lookup, under ledgerId:attempt: paid, with the payment's id and the row's amount", async () => {
      const lookup = vi.spyOn(payments, "findPaymentByReference");
      const result = await takeFirst();
      expect(payments.charges).toEqual([{ ...request(1, SOURCE), result: { outcome: "paid", paymentId: expect.any(String) } }]);
      expect(result).toEqual({ outcome: "paid", paymentId: payments.charges[0]?.result.paymentId, amountCents: 5000 });
      expect(lookup).not.toHaveBeenCalled();
    });

    it("AC5: a decline is given back with its code and its attempt", async () => {
      payments.declineCard(SOURCE, "INSUFFICIENT_FUNDS");
      expect(await takeFirst()).toEqual({ outcome: "declined", code: "INSUFFICIENT_FUNDS", attempt: 1 });
    });

    it("AC2, AC10: no answer is unknown, with the error; the charge stays out, as it was sent", async () => {
      const outage = paymentsError("SERVICE_UNAVAILABLE", "API_ERROR");
      vi.spyOn(payments, "charge").mockRejectedValue(outage);
      now = after(1000);
      expect(await takeFirst()).toEqual({ outcome: "unknown", error: outage });
      expect(await state()).toEqual(["pending", 1, SENT_AT]);
    });

    it("AC8: a key Square has seen is unknown, and the charge stays out: a first charge never goes to the next key", async () => {
      await firstReached("declined");
      const charge = vi.spyOn(payments, "charge");
      now = after(TEN_MINUTES);
      expect(await take({ first: true })).toMatchObject({ outcome: "unknown" });
      expect(keysSent(charge)).toEqual([keyOf(1)]);
      expect(await state()).toEqual(["pending", 1, SENT_AT]);
    });

    it.each(REFUSALS)("AC21: %s ends the charge, as the actor: refused, no charge out, the attempt one higher, and no event", async (_what, refused) => {
      vi.spyOn(payments, "charge").mockRejectedValue(refused());
      const withActor = vi.spyOn(repo, "withActor");
      expect(await takeFirst()).toEqual({ outcome: "refused" });
      expect(actorsOf(withActor)).toEqual([actor()]);
      expect(await state()).toEqual(["pending", 2, null]);
      expect(repo.events()).toEqual([]);
    });

    it.each<[string, () => Promise<unknown>, unknown[]]>([
      ["another submit has taken over", () => anotherMarks(after(5000)), ["pending", 1, after(5000)]],
      ["another tab settled", () => repo.recordSignupDecline(row.ledgerId), ["declined", 1, null]],
    ])("AC21: a refused charge %s meanwhile is unknown, and the row stays as that left it", async (_what, other, left) => {
      vi.spyOn(payments, "charge").mockImplementation(async () => {
        await other();
        throw paymentsError("INVALID_VALUE");
      });
      expect(await takeFirst()).toMatchObject({ outcome: "unknown" });
      expect(await state()).toEqual(left);
    });

    it("AC21: a refused charge whose end cannot be written is unknown, and the charge stays out", async () => {
      vi.spyOn(payments, "charge").mockRejectedValue(paymentsError("INVALID_VALUE"));
      const abandon = vi.spyOn(repo, "abandonCharge").mockRejectedValueOnce(new Error("write failed"));
      expect(await takeFirst()).toMatchObject({ outcome: "unknown" });
      expect(abandon).toHaveBeenCalledTimes(1);
      expect(await state()).toEqual(["pending", 1, SENT_AT]);
    });
  });

  describe("a submit over a charge that is out", () => {
    it("AC6: Square is asked for a payment under the ledger id since the row's creation; found: paid with what Square took, no charge sent, the row as it was", async () => {
      await payments.charge({ ...request(1, SOURCE), amountCents: 7000 });
      const lookup = vi.spyOn(payments, "findPaymentByReference");
      const charge = vi.spyOn(payments, "charge");
      now = after(MINUTE);
      const result = await take();
      expect(lookup.mock.calls).toEqual([[{ referenceId: row.ledgerId, since: row.createdAt }]]);
      expect(result).toEqual({ outcome: "paid", paymentId: payments.charges[0]?.result.paymentId, amountCents: 7000 });
      expect(charge).not.toHaveBeenCalled();
      expect(await state()).toEqual(["pending", 1, SENT_AT]);
    });

    // The lookup's own error says nothing about the charge, so one that would refuse a charge ends nothing here.
    it.each<[string, Error]>([
      ["refused by Square", paymentsError("INVALID_VALUE")],
      ["failed by Square", paymentsError("SERVICE_UNAVAILABLE", "API_ERROR")],
      ["unanswered", noAnswer()],
    ])("AC6: a lookup %s is unknown, with the error: nothing sent, the row as it was", async (_how, error) => {
      vi.spyOn(payments, "findPaymentByReference").mockRejectedValue(error);
      const charge = vi.spyOn(payments, "charge");
      now = after(TEN_MINUTES);
      expect(await take()).toEqual({ outcome: "unknown", error });
      expect(charge).not.toHaveBeenCalled();
      expect(await state()).toEqual(["pending", 1, SENT_AT]);
    });

    it("AC7: none found: the row is marked sent at the clock's moment, then the new card is charged under the same key, for the row's amount: paid", async () => {
      const lookup = vi.spyOn(payments, "findPaymentByReference");
      const atCharge: unknown[] = [];
      const charge = duringTheCharge(async () => atCharge.push(await state()));
      now = after(MINUTE);
      const result = await take();
      expect(payments.charges).toEqual([{ ...request(1, OTHER), result: { outcome: "paid", paymentId: expect.any(String) } }]);
      expect(result).toEqual({ outcome: "paid", paymentId: payments.charges[0]?.result.paymentId, amountCents: 5000 });
      expect(atCharge).toEqual([["pending", 1, after(MINUTE)]]);
      expect(lookup.mock.invocationCallOrder[0]).toBeLessThan(charge.mock.invocationCallOrder[0] ?? 0);
    });

    it("AC7: the row is marked at the clock's reading then, not at the lookup's", async () => {
      const real = payments.findPaymentByReference.bind(payments);
      vi.spyOn(payments, "findPaymentByReference").mockImplementation(async (input) => {
        const payment = await real(input);
        now = after(3 * MINUTE);
        return payment;
      });
      vi.spyOn(payments, "charge").mockRejectedValue(noAnswer());
      now = after(MINUTE);
      await take();
      expect(await state()).toEqual(["pending", 1, after(3 * MINUTE)]);
    });

    it("AC7: the new card declined is given back with its code and the attempt", async () => {
      payments.declineCard(OTHER, "CVV_FAILURE");
      now = after(MINUTE);
      expect(await take()).toEqual({ outcome: "declined", code: "CVV_FAILURE", attempt: 1 });
    });

    it("AC7: no answer is unknown, with the error, and the charge is out since this submit", async () => {
      const outage = paymentsError("SERVICE_UNAVAILABLE", "API_ERROR");
      vi.spyOn(payments, "charge").mockRejectedValue(outage);
      now = after(TEN_MINUTES);
      expect(await take()).toEqual({ outcome: "unknown", error: outage });
      expect(await state()).toEqual(["pending", 1, after(TEN_MINUTES)]);
    });

    it("AC7, AC21: no answer and then a refused resend is unknown, and the charge is out since this submit: its first send may have been taken", async () => {
      vi.spyOn(payments, "charge").mockRejectedValueOnce(noAnswer()).mockRejectedValueOnce(paymentsError("CARD_TOKEN_USED"));
      now = after(MINUTE);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(await state()).toEqual(["pending", 1, after(MINUTE)]);
    });

    it("AC7: when another submit took the charge over after the row was read, it is unknown: nothing is sent, and the other's mark stays", async () => {
      await anotherMarks(after(MINUTE));
      const charge = vi.spyOn(payments, "charge");
      now = after(TEN_MINUTES);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(charge).not.toHaveBeenCalled();
      expect(await state()).toEqual(["pending", 1, after(MINUTE)]);
    });

    it("AC7: a mark that cannot be written is unknown, and nothing is sent", async () => {
      const mark = vi.spyOn(repo, "markChargeSent").mockRejectedValueOnce(new Error("write failed"));
      const charge = vi.spyOn(payments, "charge");
      now = after(MINUTE);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(mark).toHaveBeenCalledTimes(1);
      expect(charge).not.toHaveBeenCalled();
      expect(await state()).toEqual(["pending", 1, SENT_AT]);
    });

    it.each(REFUSALS)("AC21: %s is refused: the mark is put back, as the actor, and the earlier charge is still out; no event", async (_what, refused) => {
      vi.spyOn(payments, "charge").mockRejectedValue(refused());
      const withActor = vi.spyOn(repo, "withActor");
      now = after(TEN_MINUTES);
      expect(await take()).toEqual({ outcome: "refused" });
      expect(actorsOf(withActor)).toEqual([actor()]);
      expect(await state()).toEqual(["pending", 1, SENT_AT]);
      expect(repo.events()).toEqual([]);
    });

    it("AC21: refused once another submit has taken the charge over is unknown, and the other's mark stays", async () => {
      vi.spyOn(payments, "charge").mockImplementation(async () => {
        await anotherMarks(after(2 * MINUTE));
        throw paymentsError("INVALID_VALUE");
      });
      now = after(MINUTE);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(await state()).toEqual(["pending", 1, after(2 * MINUTE)]);
    });
  });

  describe("AC8 — Square has seen the key, and no payment is found", () => {
    /** The clock once Square has answered the first key: a restart's moment. */
    const RESTARTED_AT = after(TEN_MINUTES + 2000);

    beforeEach(async () => {
      await firstReached("declined");
    });

    it("AC8: the lookup started ten minutes after the row's charge was sent: the same card is charged under the next attempt's key, the row out at that attempt by then, every write the actor's: paid", async () => {
      const real = payments.charge.bind(payments);
      const atCharge: unknown[] = [];
      vi.spyOn(payments, "charge").mockImplementation(async (input) => {
        if (input.idempotencyKey === keyOf(2)) atCharge.push(await state());
        else now = RESTARTED_AT;
        return real(input);
      });
      const withActor = vi.spyOn(repo, "withActor");
      now = after(TEN_MINUTES);
      const result = await take();
      expect(payments.charges.slice(1)).toEqual([{ ...request(2, OTHER), result: { outcome: "paid", paymentId: expect.any(String) } }]);
      expect(result).toEqual({ outcome: "paid", paymentId: payments.charges[1]?.result.paymentId, amountCents: 5000 });
      expect(atCharge).toEqual([["pending", 2, RESTARTED_AT]]);
      expect(actorsOf(withActor)).toEqual([actor()]);
      expect(repo.events()).toEqual([]);
    });

    it("AC8: a millisecond under ten minutes it is unknown: nothing more is sent, and the mark is put back", async () => {
      const charge = vi.spyOn(payments, "charge");
      now = after(TEN_MINUTES - 1);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(keysSent(charge)).toEqual([keyOf(1)]);
      expect(await state()).toEqual(["pending", 1, SENT_AT]);
    });

    it("AC8: the ten minutes run to the lookup's start: one started a millisecond under them that answers past them is unknown", async () => {
      const real = payments.findPaymentByReference.bind(payments);
      vi.spyOn(payments, "findPaymentByReference").mockImplementation(async (input) => {
        const payment = await real(input);
        now = after(TEN_MINUTES + MINUTE);
        return payment;
      });
      const charge = vi.spyOn(payments, "charge");
      now = after(TEN_MINUTES - 1);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(keysSent(charge)).toEqual([keyOf(1)]);
      expect(await state()).toEqual(["pending", 1, SENT_AT]);
    });

    it("AC8: the ten minutes run from the moment the row was read with, not the charge's first send: a charge taken over four minutes ago is unknown", async () => {
      await anotherMarks(after(6 * MINUTE));
      read = await outRow();
      const charge = vi.spyOn(payments, "charge");
      now = after(TEN_MINUTES);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(keysSent(charge)).toEqual([keyOf(1)]);
      expect(await state()).toEqual(["pending", 1, after(6 * MINUTE)]);
    });

    it("AC8: the restarted charge declined is given back with its code and the new attempt", async () => {
      payments.declineCard(OTHER, "INSUFFICIENT_FUNDS");
      now = after(TEN_MINUTES);
      expect(await take()).toEqual({ outcome: "declined", code: "INSUFFICIENT_FUNDS", attempt: 2 });
    });

    /** The restarted charge, the one under attempt 2's key, fails with `error`; any other goes to Square. */
    const restartFails = (error: Error) => {
      const real = payments.charge.bind(payments);
      return vi.spyOn(payments, "charge").mockImplementation((input) => {
        if (input.idempotencyKey === keyOf(2)) return Promise.reject(error);
        now = RESTARTED_AT;
        return real(input);
      });
    };

    it("AC8: the restarted charge with no answer is unknown, out at its attempt", async () => {
      restartFails(noAnswer());
      now = after(TEN_MINUTES);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(await state()).toEqual(["pending", 2, RESTARTED_AT]);
    });

    it("AC8: the restarted charge whose key Square has seen is unknown, out at its attempt: it never goes to a third key", async () => {
      const charge = restartFails(new IdempotencyKeyReusedError({ status: 400, category: "INVALID_REQUEST_ERROR", code: "IDEMPOTENCY_KEY_REUSED", detail: "Square's text" }));
      now = after(TEN_MINUTES);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(keysSent(charge)).toEqual([keyOf(1), keyOf(2)]);
      expect(await state()).toEqual(["pending", 2, RESTARTED_AT]);
    });

    it.each(REFUSALS)("AC21: %s on the restarted charge ends it, as a first charge of its attempt: refused, no charge out, the attempt one higher", async (_what, refused) => {
      restartFails(refused());
      now = after(TEN_MINUTES);
      expect(await take()).toEqual({ outcome: "refused" });
      expect(await state()).toEqual(["pending", 3, null]);
    });

    it("AC21: a restarted charge refused once another submit has taken it over is unknown, and the row stays as that left it", async () => {
      const real = payments.charge.bind(payments);
      vi.spyOn(payments, "charge").mockImplementation(async (input) => {
        if (input.idempotencyKey !== keyOf(2)) return real(input);
        await anotherMarks(after(TEN_MINUTES + MINUTE));
        throw paymentsError("INVALID_VALUE");
      });
      now = after(TEN_MINUTES);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(await state()).toEqual(["pending", 2, after(TEN_MINUTES + MINUTE)]);
    });

    it.each([
      ["ten minutes or more, so it would restart", TEN_MINUTES],
      ["under ten minutes, so it would put its mark back", MINUTE],
    ])("AC8: another submit takes the charge over before the answer, %s: unknown, nothing more sent, and the other's mark stays", async (_what, elapsed) => {
      const charge = duringTheCharge(() => anotherMarks(after(elapsed + 5000)));
      now = after(elapsed);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(keysSent(charge)).toEqual([keyOf(1)]);
      expect(await state()).toEqual(["pending", 1, after(elapsed + 5000)]);
    });

    it.each(["restartCharge", "restoreChargeSent"] as const)("AC8: a %s that cannot be written is unknown, and nothing more is sent", async (method) => {
      const write = vi.spyOn(repo, method).mockRejectedValueOnce(new Error("write failed"));
      const charge = vi.spyOn(payments, "charge");
      now = after(method === "restartCharge" ? TEN_MINUTES : MINUTE);
      expect(await take()).toMatchObject({ outcome: "unknown" });
      expect(write).toHaveBeenCalledTimes(1);
      expect(keysSent(charge)).toEqual([keyOf(1)]);
    });
  });
});

// AC23: two submits of two cards for one week, the second landing after a step of the first, or the charge run landing there,
// over every way an answer can be lost. Each world is a new repository and a new Square; `payments.charges` is everything
// Square took or declined, so it counts what a member was charged. A submit here is what signUp and updateCard make of
// takeCharge's answer: their own tests take one case of each.
describe("AC23 (issue 254) — two submits and the charge run are never two payments", () => {
  const SITE_URL = "https://members.example.test";
  const FIRST_SENT = new Date("2026-11-06T15:00:00.000Z");
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DECLINED_WEEK = "2027-01-10";
  const OLD_CARD: Card = { id: "ccof:old-card", brand: "MASTERCARD", last4: "4444", expMonth: 1, expYear: 2029 };
  /** The cards: the charge already out, the submit under test, the one that lands in it, and the one that ends the row. */
  const [EARLIER, A, B, LAST] = ["cnon:earlier", "cnon:a", "cnon:b", "cnon:last"] as const;

  const KINDS = ["a signup's row", "a card update's row"] as const;
  type Kind = (typeof KINDS)[number];

  /** What becomes of a card's charge. */
  const FATES = ["paid", "declined", "refused", "never arrives", "paid, answer lost", "declined, answer lost"] as const;
  type Fate = (typeof FATES)[number];

  /** The steps of the submit under test, each the moment after: a write's once it is committed. */
  const STEPS = ["read", "lookup", "mark", "charge", "charge again", "restart", "restore", "abandon", "decline", "save"] as const;
  type Step = (typeof STEPS)[number];
  const WRITES = { markChargeSent: "mark", restartCharge: "restart", restoreChargeSent: "restore", abandonCharge: "abandon", recordSignupDecline: "decline" } as const;

  type Row = Parameters<typeof takeCharge>[3]["row"];

  let kind: Kind;
  let subscriptionId: string;
  let ledgerId: string;
  let now: Date;
  let fates: Map<string, Fate>;
  /** Square's own charge, past the fates: a send that arrives late. */
  let arriveAtSquare: FakePayments["charge"];
  /** Called as each step of a submit happens, with the step. */
  let reached: (step: Step) => Promise<void>;

  /** A new world: the member's row, nothing sent, and a Square that gives each card its fate. */
  async function world(of: Kind): Promise<void> {
    kind = of;
    await freshSignup();
    subscriptionId = row.subscriptionId;
    ledgerId = row.ledgerId;
    now = FIRST_SENT;
    fates = new Map();
    reached = async () => undefined;
    if (kind === "a card update's row") {
      expect(await repo.confirmSignupRows(row.ledgerId, "PAYMENT_SIGNUP", 5000, PAID_AT, OLD_CARD)).toBe("confirmed");
      ledgerId = await repo.addLedgerRow(subscriptionId, DECLINED_WEEK, "declined", 5000);
    }

    const charge = payments.charge.bind(payments);
    arriveAtSquare = charge;
    const sends = new Map<string, number>();
    payments.charge = async (input) => {
      const fate = fates.get(input.sourceId);
      const nth = (sends.get(input.sourceId) ?? 0) + 1;
      sends.set(input.sourceId, nth);
      const atSquare = async () => {
        if (fate === "never arrives") throw noAnswer();
        if (fate === "refused") throw paymentsError("INVALID_VALUE");
        const result = await charge(input);
        if (fate?.endsWith("answer lost")) throw noAnswer();
        return result;
      };
      try {
        return await atSquare();
      } finally {
        await reached(nth === 1 ? "charge" : "charge again");
      }
    };
    const lookup = payments.findPaymentByReference.bind(payments);
    payments.findPaymentByReference = async (input) => {
      const payment = await lookup(input);
      await reached("lookup");
      return payment;
    };
    const save = payments.saveCard.bind(payments);
    payments.saveCard = async (input) => {
      const card = await save(input);
      await reached("save");
      return card;
    };

    // A write's step is reached once its transaction has committed, so what lands there meets committed rows.
    let written: Step[] = [];
    let open = 0;
    const withActor = repo.withActor.bind(repo);
    repo.withActor = async (who, fn) => {
      open += 1;
      let result;
      try {
        result = await withActor(who, fn);
      } finally {
        open -= 1;
      }
      const steps = written;
      written = [];
      for (const step of steps) await reached(step);
      return result;
    };
    const methods = repo as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const [method, step] of Object.entries(WRITES)) {
      const real = methods[method];
      methods[method] = async function (this: Repository, ...args: unknown[]) {
        const answer = await real?.apply(this, args);
        if (open > 0) written.push(step);
        else await reached(step);
        return answer;
      };
    }
  }

  const fateOf = (card: string, fate: Fate): void => {
    fates.set(card, fate);
    if (fate === "declined" || fate === "declined, answer lost") payments.declineCard(card, "GENERIC_DECLINE");
  };

  /** The row a submit charges, as its caller reads it: its charge already out, or started by this one. Null when nothing is owed. */
  async function enter(): Promise<{ row: Row; first: boolean } | null> {
    const asRow = (held: { chargeSentAt: Date | null } & Omit<Row, "chargeSentAt">): Row => {
      if (held.chargeSentAt === null) throw new Error("the row a submit charges has no charge out");
      return { ...held, chargeSentAt: held.chargeSentAt };
    };
    if (kind === "a card update's row") {
      const claim = await repo.claimCardUpdate(subscriptionId, now);
      if (claim.kind === "nothing_owed") return null;
      expect(["claimed", "out"]).toContain(claim.kind);
      if (claim.kind !== "claimed" && claim.kind !== "out") throw new Error(`the claim was ${claim.kind}`);
      return { row: asRow(claim.charge), first: claim.kind === "claimed" };
    }
    if (await repo.findActiveSubscription(memberId, productId)) return null;
    const held = await repo.findPendingSignup(memberId, productId);
    if (held?.chargeSentAt) return { row: asRow(held), first: false };
    await repo.savePendingSignup(signupInput);
    expect(await repo.startSignupCharge(subscriptionId, now)).toMatchObject({ amountCents: 5000 });
    const started = await repo.findPendingSignup(memberId, productId);
    if (!started) throw new Error("the signup just started is gone");
    return { row: asRow(started), first: true };
  }

  async function submit(card: string): Promise<void> {
    const entered = await enter();
    if (entered === null) return;
    await reached("read");
    const taken = await takeCharge(repo, payments, actor(), { ...entered, sourceId: card, customerId, clock: () => now });
    if (taken.outcome === "paid") await settlePaid(repo, payments, actor(), { ledgerId, paymentId: taken.paymentId, amountCents: taken.amountCents, customerId, memberId, paidAt: now });
    if (taken.outcome === "declined") await repo.withActor(actor(), (scoped) => scoped.recordSignupDecline(ledgerId, taken.attempt));
  }

  const chargeRun = () =>
    runCharges({ repo, payments, email: new FakeEmail(), now, clock: () => now, siteUrl: SITE_URL, accountUrl: `${SITE_URL}/account`, cardUrl: `${SITE_URL}/account/card` });

  /**
   * Submit `card` with `other` landing once, `delay` after its first `step`; with `late`, the earlier charge reaches Square
   * right after the first lookup there is, which found none. Whether the step was reached.
   */
  async function overtakenAt(step: Step, card: string, other: () => Promise<unknown>, delay: number, late: boolean): Promise<boolean> {
    let landed = false;
    let arrived = !late;
    reached = async (at) => {
      if (at === "lookup" && !arrived) {
        arrived = true;
        await arriveAtSquare(earlierRequest());
      }
      if (landed || at !== step) return;
      landed = true;
      now = new Date(now.getTime() + delay);
      await other();
    };
    await submit(card);
    reached = async () => undefined;
    return landed;
  }

  const paymentsTaken = () => payments.charges.filter((charge) => charge.referenceId === ledgerId && charge.result.outcome === "paid").length;
  const isPaid = async () => (await repo.findPaidCharge(subscriptionId, ledgerId)) !== null;

  /** What the earlier submit sent Square. */
  const earlierRequest = () => ({
    customerId,
    sourceId: EARLIER,
    amountCents: 5000,
    idempotencyKey: `${ledgerId}:${kind === "a signup's row" ? 1 : 2}`,
    referenceId: ledgerId,
    customerInitiated: true,
  });

  /**
   * The charge already out when the submit under test starts: none, so its own is the first, or an earlier one of this fate.
   * "arrives late" is on its way until the submit's lookup is over, which can only be under ten minutes after it was sent.
   */
  const EARLIER_FATES = [null, "never arrives", "arrives late", "paid, answer lost", "declined, answer lost"] as const;
  /** How long before the submit under test it was sent. */
  const elapsedFor = (earlier: (typeof EARLIER_FATES)[number]): number[] => (earlier === null ? [0] : earlier === "arrives late" ? [MINUTE] : [MINUTE, 10 * MINUTE]);
  /** How long after the step the other one lands: past ten minutes too where Square has answered, as a slow tab would meet it. */
  const delaysAt = (step: Step): number[] => (step === "charge" ? [SECOND, 10 * MINUTE] : [SECOND]);

  const cases = KINDS.flatMap((of) => STEPS.map((step) => [of, step] as const));

  /** Every world in which `other` lands at `step` of a submit, each checked; in how many the step was reached. */
  async function everyWorld(of: Kind, step: Step, other: () => Promise<unknown>, otherFates: readonly (Fate | null)[]): Promise<number> {
    let worlds = 0;
    let landed = 0;
    for (const earlier of EARLIER_FATES)
      for (const elapsed of elapsedFor(earlier))
        for (const delay of delaysAt(step))
          for (const fate of FATES)
            for (const otherFate of otherFates) {
              await world(of);
              if (earlier !== null) {
                fateOf(EARLIER, earlier === "arrives late" ? "never arrives" : earlier);
                await submit(EARLIER);
                now = new Date(FIRST_SENT.getTime() + elapsed);
              }
              fateOf(A, fate);
              if (otherFate !== null) fateOf(B, otherFate);
              if (await overtakenAt(step, A, other, delay, earlier === "arrives late")) landed += 1;
              const label = `earlier ${earlier}, ${elapsed / MINUTE} min before; this one ${fate}; the other ${otherFate ?? "the run"}, ${delay / SECOND} s after the step`;
              expect(paymentsTaken(), `payments: ${label}`).toBeLessThanOrEqual(1);

              // The row ends: by the next submit, or, in two worlds of five, by a run when Square holds the payment.
              now = new Date(now.getTime() + HOUR);
              worlds += 1;
              if (worlds % 5 < 2) {
                const taken = paymentsTaken();
                await chargeRun();
                if (taken === 1) expect(await isPaid(), `paid by the run: ${label}`).toBe(true);
              }
              await submit(LAST);
              expect([await isPaid(), paymentsTaken()], `paid once, ended: ${label}`).toEqual([true, 1]);
            }
    return landed;
  }

  it.each(cases)("AC23: on %s, a second card lands after the first's %s: at most one payment, whatever answers are lost, and the row ends paid once", async (of, step) => {
    expect(await everyWorld(of, step, () => submit(B), FATES)).toBeGreaterThan(0);
  });

  it.each(cases)("AC23: on %s, the charge run lands after the submit's %s: at most one payment, whatever answers are lost, and the row ends paid once", async (of, step) => {
    expect(await everyWorld(of, step, chargeRun, [null])).toBeGreaterThan(0);
  });
});
