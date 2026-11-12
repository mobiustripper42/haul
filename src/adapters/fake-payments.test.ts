// Issue 54: the payments contract (AC1–AC9) against FakePayments, then the fake's own surface —
// its input check (AC10), the retry count Square can't show (AC8), what it refuses (AC16) and its
// test handles (AC17).
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as PortModule from "../ports/payments.js";
import { checkPaymentsInput, IdempotencyKeyReusedError, PaymentsError } from "../ports/payments.js";
import { FakePayments } from "./fake-payments.js";
import {
  callPayments,
  PAYMENTS_INPUT_BREACHES,
  PAYMENTS_METHODS,
  rejectionOf,
  runPaymentsContract,
  VALID_PAYMENTS_INPUTS,
} from "./payments-contract.js";
import { SQUARE_SANDBOX_VALUES } from "./square-payments.js";

// checkPaymentsInput keeps its real behaviour; the wrapper only lets AC10 see that the fake calls it.
vi.mock("../ports/payments.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PortModule>();
  return { ...actual, checkPaymentsInput: vi.fn(actual.checkPaymentsInput) };
});
const realCheck = (await vi.importActual<typeof PortModule>("../ports/payments.js")).checkPaymentsInput;
const checkSpy = vi.mocked(checkPaymentsInput);

afterEach(() => {
  checkSpy.mockReset();
  checkSpy.mockImplementation(realCheck);
});

runPaymentsContract("fake", () => new FakePayments());

const CREATED = new Date("2026-10-01T12:00:00.000Z");
const UPDATED = new Date("2026-10-15T12:00:00.000Z");

async function customerWithCard(fake: FakePayments, n = 1): Promise<{ customerId: string; cardId: string }> {
  const customer = await fake.createCustomer({ email: `member${n}@example.com`, idempotencyKey: `customer-${n}` });
  const card = await fake.saveCard({
    customerId: customer.id,
    sourceId: SQUARE_SANDBOX_VALUES.cardNonceOk,
    idempotencyKey: `card-${n}`,
  });
  return { customerId: customer.id, cardId: card.id };
}

describe("AC8 (issue 54) — FakePayments records a retried charge once", () => {
  it("AC8: a charge retried with the same idempotencyKey and input leaves one entry in charges", async () => {
    const fake = new FakePayments();
    const { customerId, cardId } = await customerWithCard(fake);
    const input = { customerId, cardId, amountCents: 5000, idempotencyKey: "charge-1" };
    const first = await fake.charge({ ...input });
    const second = await fake.charge({ ...input });
    expect(first.outcome).toBe("paid");
    expect(second).toEqual(first);
    expect(fake.charges).toHaveLength(1);
  });
});

describe("AC10 (issue 54) — FakePayments checks input first", () => {
  it.each(PAYMENTS_INPUT_BREACHES.map((b) => [b.label, b] as const))(
    "AC10: %s rejects with a RangeError naming the port's field",
    async (_label, breach) => {
      const error = await rejectionOf(callPayments(new FakePayments(), breach.method, breach.input));
      expect(error).toBeInstanceOf(RangeError);
      expect((error as Error).message).toContain(breach.field);
      expect((error as Error).message).not.toContain(breach.snake);
    },
  );

  it.each(PAYMENTS_METHODS)("AC10: %s calls checkPaymentsInput with its name and input before anything else", async (method) => {
    const sentinel = new Error("checkPaymentsInput refused");
    checkSpy.mockImplementationOnce(() => {
      throw sentinel;
    });
    const fake = new FakePayments();
    const input = VALID_PAYMENTS_INPUTS[method];
    const error = await rejectionOf(callPayments(fake, method, input));
    expect(error).toBe(sentinel);
    expect(checkSpy).toHaveBeenCalledWith(method, input);
    expect(fake.customers).toEqual([]);
    expect(fake.cards).toHaveLength(0);
    expect(fake.charges).toHaveLength(0);
  });
});

describe("AC16 (issue 54) — FakePayments refuses what Square refuses", () => {
  it("AC16: saveCard for a customer it never made rejects with PaymentsError", async () => {
    const fake = new FakePayments();
    const error = await rejectionOf(
      fake.saveCard({ customerId: "NEVER_MADE", sourceId: SQUARE_SANDBOX_VALUES.cardNonceOk, idempotencyKey: "card-1" }),
    );
    expect(error).toBeInstanceOf(PaymentsError);
    expect(fake.cards).toHaveLength(0);
  });

  it("AC16: charge with a card saved to another customer rejects with PaymentsError and records no charge", async () => {
    const fake = new FakePayments();
    const { cardId } = await customerWithCard(fake, 1);
    const other = await fake.createCustomer({ email: "grace@example.com", idempotencyKey: "customer-other" });
    const error = await rejectionOf(
      fake.charge({ customerId: other.id, cardId, amountCents: 5000, idempotencyKey: "charge-1" }),
    );
    expect(error).toBeInstanceOf(PaymentsError);
    expect(fake.charges).toHaveLength(0);
  });

  it("AC16: charge with a card id it never saved rejects with PaymentsError", async () => {
    const fake = new FakePayments();
    const customer = await fake.createCustomer({ email: "ada@example.com", idempotencyKey: "customer-1" });
    const error = await rejectionOf(
      fake.charge({ customerId: customer.id, cardId: "ccof:never-saved", amountCents: 5000, idempotencyKey: "charge-1" }),
    );
    expect(error).toBeInstanceOf(PaymentsError);
  });

  it("AC16: Square's ccof:customer-card-id-ok charges as paid, even for a customer it never made", async () => {
    const fake = new FakePayments();
    const result = await fake.charge({
      customerId: "NEVER_MADE",
      cardId: SQUARE_SANDBOX_VALUES.cardOnFileOk,
      amountCents: 5000,
      idempotencyKey: "charge-1",
    });
    expect(result).toEqual({ outcome: "paid", paymentId: expect.any(String) });
    expect(result.paymentId).not.toBe("");
  });

  it("AC16: Square's ccof:customer-card-id-declined charges as declined with code GENERIC_DECLINE", async () => {
    const fake = new FakePayments();
    const result = await fake.charge({
      customerId: "NEVER_MADE",
      cardId: SQUARE_SANDBOX_VALUES.cardOnFileDeclined,
      amountCents: 5000,
      idempotencyKey: "charge-1",
    });
    expect(result).toMatchObject({ outcome: "declined", code: "GENERIC_DECLINE" });
  });

  it("AC16: createCustomer with a key already used for a different email rejects with IdempotencyKeyReusedError", async () => {
    const fake = new FakePayments();
    await fake.createCustomer({ email: "ada@example.com", idempotencyKey: "customer-1" });
    const error = await rejectionOf(fake.createCustomer({ email: "grace@example.com", idempotencyKey: "customer-1" }));
    expect(error).toBeInstanceOf(IdempotencyKeyReusedError);
    expect(fake.customers).toHaveLength(1);
  });

  it("AC16: createCustomer with a key already used without names, now with a givenName, rejects with IdempotencyKeyReusedError", async () => {
    const fake = new FakePayments();
    await fake.createCustomer({ email: "ada@example.com", idempotencyKey: "customer-1" });
    const error = await rejectionOf(
      fake.createCustomer({ email: "ada@example.com", idempotencyKey: "customer-1", givenName: "Ada" }),
    );
    expect(error).toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it("AC16: saveCard with a key already used for a different customer rejects with IdempotencyKeyReusedError", async () => {
    const fake = new FakePayments();
    const ada = await fake.createCustomer({ email: "ada@example.com", idempotencyKey: "customer-1" });
    const grace = await fake.createCustomer({ email: "grace@example.com", idempotencyKey: "customer-2" });
    await fake.saveCard({ customerId: ada.id, sourceId: SQUARE_SANDBOX_VALUES.cardNonceOk, idempotencyKey: "card-1" });
    const error = await rejectionOf(
      fake.saveCard({ customerId: grace.id, sourceId: SQUARE_SANDBOX_VALUES.cardNonceOk, idempotencyKey: "card-1" }),
    );
    expect(error).toBeInstanceOf(IdempotencyKeyReusedError);
    expect(fake.cards).toHaveLength(1);
  });

  it("AC16: saveCard retried with the same key and input resolves to the same card and saves one", async () => {
    const fake = new FakePayments();
    const ada = await fake.createCustomer({ email: "ada@example.com", idempotencyKey: "customer-1" });
    const input = { customerId: ada.id, sourceId: SQUARE_SANDBOX_VALUES.cardNonceOk, idempotencyKey: "card-1" };
    const first = await fake.saveCard({ ...input });
    const second = await fake.saveCard({ ...input });
    expect(first.id).not.toBe("");
    expect(second).toEqual(first);
    expect(fake.cards).toHaveLength(1);
  });
});

describe("AC17 (issue 54) — FakePayments' test handles", () => {
  it("AC17: addCustomer returns, synchronously, the Customer it made, with an id the fake assigns", () => {
    const fake = new FakePayments();
    const customer = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    expect(customer).not.toBeInstanceOf(Promise);
    expect(customer).toEqual({ id: expect.any(String), email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    expect(customer.id).not.toBe("");
  });

  it("AC17: addCustomer gives each customer its own id", () => {
    const fake = new FakePayments();
    const first = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    const second = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    expect(first.id).not.toBe("");
    expect(second.id).not.toBe(first.id);
  });

  it("AC17: a customer addCustomer made is found by findCustomersByEmail", async () => {
    const fake = new FakePayments();
    const customer = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    expect(await fake.findCustomersByEmail("ada@example.com")).toEqual([customer]);
  });

  it("AC17: customers lists those addCustomer and createCustomer made", async () => {
    const fake = new FakePayments();
    const added = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    const created = await fake.createCustomer({ email: "grace@example.com", idempotencyKey: "customer-1" });
    expect(fake.customers.map((c) => c.id).sort()).toEqual([added.id, created.id].sort());
    expect(added.id).not.toBe("");
  });

  it("AC17: changing what customers returns changes nothing stored", () => {
    const fake = new FakePayments();
    const added = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    const returned = fake.customers;
    expect(returned).toHaveLength(1);
    const [first] = returned;
    if (first) first.email = "mallory@example.com";
    returned.length = 0;
    expect(fake.customers).toEqual([added]);
  });

  it("AC17: cards lists each saved card, and changing what it returns changes nothing stored", async () => {
    const fake = new FakePayments();
    await customerWithCard(fake, 1);
    await customerWithCard(fake, 2);
    const returned = fake.cards;
    expect(returned).toHaveLength(2);
    returned.length = 0;
    expect(fake.cards).toHaveLength(2);
  });

  it("AC17: charges holds one entry per distinct idempotency key, and changing what it returns changes nothing stored", async () => {
    const fake = new FakePayments();
    const { customerId, cardId } = await customerWithCard(fake);
    await fake.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: "charge-1" });
    await fake.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: "charge-2" });
    await fake.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: "charge-1" });
    const returned = fake.charges;
    expect(returned).toHaveLength(2);
    returned.length = 0;
    expect(fake.charges).toHaveLength(2);
  });

  it("AC17: a declined charge adds a charges entry; one that rejects adds none", async () => {
    const fake = new FakePayments();
    const declined = await fake.charge({
      customerId: "NEVER_MADE",
      cardId: SQUARE_SANDBOX_VALUES.cardOnFileDeclined,
      amountCents: 5000,
      idempotencyKey: "charge-1",
    });
    expect(declined.outcome).toBe("declined");
    await rejectionOf(
      fake.charge({ customerId: "NEVER_MADE", cardId: "ccof:never-saved", amountCents: 5000, idempotencyKey: "charge-2" }),
    );
    await rejectionOf(
      fake.charge({ customerId: "NEVER_MADE", cardId: SQUARE_SANDBOX_VALUES.cardOnFileOk, amountCents: 0, idempotencyKey: "charge-3" }),
    );
    expect(fake.charges).toHaveLength(1);
  });

  it("AC17: declineCard(cardId, code) makes every later charge to that card decline with that code", async () => {
    const fake = new FakePayments();
    const { customerId, cardId } = await customerWithCard(fake);
    fake.declineCard(cardId, "INSUFFICIENT_FUNDS");
    const first = await fake.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: "charge-1" });
    const second = await fake.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: "charge-2" });
    expect(first).toMatchObject({ outcome: "declined", code: "INSUFFICIENT_FUNDS" });
    expect(second).toMatchObject({ outcome: "declined", code: "INSUFFICIENT_FUNDS" });
  });

  it("AC17: declineCard leaves other cards paying", async () => {
    const fake = new FakePayments();
    const declining = await customerWithCard(fake, 1);
    const paying = await customerWithCard(fake, 2);
    fake.declineCard(declining.cardId, "INSUFFICIENT_FUNDS");
    const result = await fake.charge({ ...paying, amountCents: 5000, idempotencyKey: "charge-1" });
    expect(result.outcome).toBe("paid");
  });

  it.each(PAYMENTS_METHODS)("AC17: failNext(error) makes the next %s reject with that very error, once", async (method) => {
    const fake = new FakePayments();
    const failure = new PaymentsError({ status: 503, category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: "" });
    const customer = await fake.createCustomer({ email: "ada@example.com", idempotencyKey: "customer-1" });
    const input = method === "saveCard" ? { ...VALID_PAYMENTS_INPUTS.saveCard, customerId: customer.id } : VALID_PAYMENTS_INPUTS[method];
    fake.failNext(failure);
    expect(await rejectionOf(callPayments(fake, method, input))).toBe(failure);
    await expect(callPayments(fake, method, input)).resolves.toBeDefined();
  });

  it("AC17: a createCustomer failNext rejected creates nothing and stores no key", async () => {
    const fake = new FakePayments();
    fake.failNext(new Error("outage"));
    await rejectionOf(fake.createCustomer({ email: "ada@example.com", idempotencyKey: "customer-1" }));
    expect(fake.customers).toHaveLength(0);
    const customer = await fake.createCustomer({ email: "grace@example.com", idempotencyKey: "customer-1" });
    expect(customer.email).toBe("grace@example.com");
    expect(fake.customers).toHaveLength(1);
  });

  it("AC17: a charge failNext rejected records no charge and stores no key", async () => {
    const fake = new FakePayments();
    const { customerId, cardId } = await customerWithCard(fake);
    fake.failNext(new Error("outage"));
    await rejectionOf(fake.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: "charge-1" }));
    expect(fake.charges).toHaveLength(0);
    const result = await fake.charge({ customerId, cardId, amountCents: 5100, idempotencyKey: "charge-1" });
    expect(result.outcome).toBe("paid");
    expect(fake.charges).toHaveLength(1);
  });

  it("AC17: a charge rejected for its input stores no key", async () => {
    const fake = new FakePayments();
    const { customerId, cardId } = await customerWithCard(fake);
    await rejectionOf(fake.charge({ customerId, cardId, amountCents: 0, idempotencyKey: "charge-1" }));
    const result = await fake.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: "charge-1" });
    expect(result.outcome).toBe("paid");
  });
});

describe("issue 56 — FakePayments' new methods", () => {
  it("AC6: setCustomerReference on a customer it never made rejects with PaymentsError, as Square's 404 does", async () => {
    const error = await rejectionOf(new FakePayments().setCustomerReference({ customerId: "NEVER_MADE", referenceId: "member-1" }));
    expect(error).toBeInstanceOf(PaymentsError);
  });

  it("AC6: setCustomerReference checks its input first", async () => {
    const fake = new FakePayments();
    const customer = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    const error = await rejectionOf(fake.setCustomerReference({ customerId: customer.id, referenceId: "r".repeat(41) }));
    expect(error).toBeInstanceOf(RangeError);
  });

  it("AC6: a customer's referenceId comes back on customers too", async () => {
    const fake = new FakePayments();
    const customer = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    await fake.setCustomerReference({ customerId: customer.id, referenceId: "member-1" });
    expect(fake.customers[0]?.referenceId).toBe("member-1");
  });

  it("AC6: createCustomer with a key already used with no referenceId, now with one, rejects with IdempotencyKeyReusedError", async () => {
    const fake = new FakePayments();
    await fake.createCustomer({ email: "ada@example.com", idempotencyKey: "customer-1" });
    const error = await rejectionOf(fake.createCustomer({ email: "ada@example.com", idempotencyKey: "customer-1", referenceId: "member-1" }));
    expect(error).toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it("AC10: findPaymentByReference ignores since, because FakeCharge has no time", async () => {
    const fake = new FakePayments();
    const { customerId, cardId } = await customerWithCard(fake);
    const paid = await fake.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: "charge-1", referenceId: "ledger-1" });
    const found = await fake.findPaymentByReference({ referenceId: "ledger-1", since: new Date("2099-01-01T00:00:00.000Z") });
    expect(found).toEqual({ paymentId: paid.paymentId, amountCents: 5000 });
  });

  it("AC10: of a declined attempt and a paid one under one referenceId, it finds the paid one", async () => {
    const fake = new FakePayments();
    const { customerId, cardId } = await customerWithCard(fake);
    await fake.charge({ customerId, cardId: SQUARE_SANDBOX_VALUES.cardOnFileDeclined, amountCents: 5000, idempotencyKey: "ledger-1:1", referenceId: "ledger-1" });
    const paid = await fake.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: "ledger-1:2", referenceId: "ledger-1" });
    expect(await fake.findPaymentByReference({ referenceId: "ledger-1", since: CREATED })).toEqual({ paymentId: paid.paymentId, amountCents: 5000 });
  });

  it.each([
    ["setCustomerReference", (fake: FakePayments, customerId: string) => fake.setCustomerReference({ customerId, referenceId: "member-1" })],
    ["findPaymentByReference", (fake: FakePayments) => fake.findPaymentByReference({ referenceId: "ledger-1", since: CREATED })],
  ] as const)("AC10a: failNext(error) makes the next %s reject with that very error", async (_method, call) => {
    const fake = new FakePayments();
    const customer = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    const failure = new Error("outage");
    fake.failNext(failure);
    expect(await rejectionOf(call(fake, customer.id))).toBe(failure);
  });
});

// Issue 156: setCustomerEmail, as setCustomerReference is tested above.
describe("issue 156 — FakePayments' setCustomerEmail", () => {
  it("AC11: on a customer it never made it rejects with PaymentsError, as Square's 404 does", async () => {
    const error = await rejectionOf(new FakePayments().setCustomerEmail({ customerId: "NEVER_MADE", email: "ada.new@example.com" }));
    expect(error).toBeInstanceOf(PaymentsError);
  });

  it("AC11: it checks its input first", async () => {
    const fake = new FakePayments();
    const customer = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    expect(await rejectionOf(fake.setCustomerEmail({ customerId: customer.id, email: "" }))).toBeInstanceOf(RangeError);
    expect(fake.customers[0]?.email).toBe("ada@example.com");
  });

  it("AC11: failNext(error) makes the next setCustomerEmail reject with that very error, and the email stays", async () => {
    const fake = new FakePayments();
    const customer = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    const failure = new Error("outage");
    fake.failNext(failure);
    expect(await rejectionOf(fake.setCustomerEmail({ customerId: customer.id, email: "ada.new@example.com" }))).toBe(failure);
    expect(fake.customers[0]?.email).toBe("ada@example.com");
  });

  it("AC11: the new email comes back on customers too", async () => {
    const fake = new FakePayments();
    const customer = fake.addCustomer({ email: "ada@example.com", createdAt: CREATED, updatedAt: UPDATED });
    await fake.setCustomerEmail({ customerId: customer.id, email: "ada.new@example.com" });
    expect(fake.customers[0]?.email).toBe("ada.new@example.com");
  });
});
