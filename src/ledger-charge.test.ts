// Issue 254: the three steps signup, the card update and the charge run share: sendCharge's rule for a dead token,
// settlePaid (the card saved from the payment, then the one confirm) and abandonIfDead. Their callers' tests take one case
// each way through them. Which errors are a dead token is isDeadToken's (src/ports/payments-dead-token.test.ts); what the
// confirm and the abandon write is the repository's (src/adapters/signup-contract.ts, charge-run-contract.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePayments } from "./adapters/fake-payments.js";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { sha256Key } from "./customer-match.js";
import { abandonIfDead, sendCharge, settlePaid } from "./ledger-charge.js";
import { PaymentsError } from "./ports/payments.js";
import type { Actor, PendingSignup } from "./ports/repository.js";

const SOURCE = "cnon:card-nonce-ok";
const PAID_AT = new Date("2026-11-06T15:00:05.000Z");

let repo: InMemoryRepository;
let payments: FakePayments;
let memberId: string;
let productId: string;
let customerId: string;
let row: PendingSignup;

beforeEach(async () => {
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
  row = await repo.savePendingSignup({
    memberId,
    productId,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no option"])),
    firstChargeCents: 5000,
    weeklyCents: 5000,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $50.",
    consentAt: PAID_AT,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const actor = (): Actor => ({ member: memberId });
const paymentsError = (code: string, category = "INVALID_REQUEST_ERROR") => new PaymentsError({ status: 400, category, code, detail: "Square's text" });
const deadToken = () => paymentsError("CARD_TOKEN_USED");
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

  it("AC8: a dead token is thrown at once, not resent", async () => {
    const error = deadToken();
    const charge = vi.spyOn(payments, "charge").mockRejectedValue(error);
    await expect(send()).rejects.toBe(error);
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it("AC8: any other failure and then a dead token throws the first failure: the first send may be what used the token", async () => {
    const first = noAnswer();
    const charge = vi.spyOn(payments, "charge").mockRejectedValueOnce(first).mockRejectedValueOnce(deadToken());
    await expect(send()).rejects.toBe(first);
    expect(charge).toHaveBeenCalledTimes(2);
  });

  it("AC8: two failures that are not dead tokens throw the second, as before", async () => {
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

describe("abandonIfDead (issue 254)", () => {
  beforeEach(async () => {
    await repo.startSignupCharge(row.subscriptionId, SOURCE);
  });

  it("AC8: a dead token abandons the row's charge, as the actor: true, the row pending with no token on the next attempt, and no event", async () => {
    const withActor = vi.spyOn(repo, "withActor");
    expect(await abandonIfDead(repo, actor(), row.ledgerId, deadToken())).toBe(true);
    expect(withActor.mock.calls.map(([who]) => who)).toEqual([actor()]);
    expect(await repo.findPendingSignup(memberId, productId)).toMatchObject({ ledgerStatus: "pending", attempt: 2, chargeSource: null });
    expect(repo.events()).toEqual([]);
  });

  it("AC8: any other error is false, and the row keeps its token and attempt", async () => {
    expect(await abandonIfDead(repo, actor(), row.ledgerId, noAnswer())).toBe(false);
    expect(await repo.findPendingSignup(memberId, productId)).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSource: SOURCE });
  });

  it("AC8: a dead token whose row is no longer out is true too, and the row is left as it is", async () => {
    await repo.recordSignupDecline(row.ledgerId);
    expect(await abandonIfDead(repo, actor(), row.ledgerId, deadToken())).toBe(true);
    expect(await repo.findPendingSignup(memberId, productId)).toMatchObject({ ledgerStatus: "declined", attempt: 1 });
  });
});
