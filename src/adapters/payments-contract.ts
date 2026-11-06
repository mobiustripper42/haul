/**
 * The payments port contract (issue 54, AC1–AC9). One behavioural suite, run against `FakePayments`
 * in `npm run test` (`fake-payments.test.ts`) and against `SquarePayments` on Square's sandbox in
 * `npm run test:square` (`square-payments.sandbox.ts`): if both pass it, the fake is a faithful
 * stand-in for Square (DEC-010).
 *
 * Not a test file itself, as `email-contract.ts` isn't: it registers describe/it blocks, and the two
 * files above call it. Every address it uses is fresh — `haul-sandbox-<uuid>@example.com`, or AC3's
 * mixed-case `Ada.Lovelace+<uuid>@Example.COM` — so a sandbox run never meets an earlier run's
 * customers.
 *
 * `searchWaitMs` is how long a search waits for a customer just created to appear: Square's search
 * lags ("Some updates can take up to 1 minute"). The fake shows it at once, so its run waits 0.
 *
 * It also exports AC10's input table, shared by the port's and both adapters' tests.
 *
 * Issue 56 adds what signup needs of the port: a customer's `referenceId`, read back on the customer
 * (AC6), and `findPaymentByReference`, the lookup "Try again" starts with (AC10).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IdempotencyKeyReusedError, type Customer, type PaymentsPort } from "../ports/payments.js";
import { SQUARE_SANDBOX_VALUES } from "./square-payments.js";

const freshEmail = (): string => `haul-sandbox-${randomUUID()}@example.com`;
const freshKey = (): string => randomUUID();

/** What a promise rejected with; a resolution comes back as an Error saying so, which fails any instanceof check. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => new Error(`resolved instead of rejecting: ${JSON.stringify(value)}`),
    (error: unknown) => error,
  );
}

export function runPaymentsContract(
  name: string,
  make: () => PaymentsPort | Promise<PaymentsPort>,
  options: { searchWaitMs?: number } = {},
): void {
  const searchWaitMs = options.searchWaitMs ?? 0;
  // Room for the search wait plus a handful of real round trips.
  const timeout = searchWaitMs + 30_000;

  /** Searches until `done` holds or `searchWaitMs` has passed, and returns the last result. */
  async function searchUntil(
    payments: PaymentsPort,
    email: string,
    done: (customers: Customer[]) => boolean,
  ): Promise<Customer[]> {
    const deadline = Date.now() + searchWaitMs;
    for (;;) {
      const customers = await payments.findCustomersByEmail(email);
      const left = deadline - Date.now();
      if (done(customers) || left <= 0) return customers;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, left)));
    }
  }

  /** Looks a payment up until it appears or `searchWaitMs` has passed, and returns the last result. */
  async function paymentUntilFound(payments: PaymentsPort, referenceId: string): Promise<{ paymentId: string } | null> {
    const since = new Date(Date.now() - 5 * 60_000);
    const deadline = Date.now() + searchWaitMs;
    for (;;) {
      const found = await payments.findPaymentByReference({ referenceId, since });
      const left = deadline - Date.now();
      if (found !== null || left <= 0) return found;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, left)));
    }
  }

  async function customerWithCard(payments: PaymentsPort): Promise<{ customerId: string; cardId: string }> {
    const customer = await payments.createCustomer({ email: freshEmail(), idempotencyKey: freshKey() });
    const card = await payments.saveCard({
      customerId: customer.id,
      sourceId: SQUARE_SANDBOX_VALUES.cardNonceOk,
      idempotencyKey: freshKey(),
    });
    return { customerId: customer.id, cardId: card.id };
  }

  describe(`Payments contract — ${name}`, () => {
    it("AC1: findCustomersByEmail resolves to [] for an email no customer has", { timeout }, async () => {
      const payments = await make();
      expect(await payments.findCustomersByEmail(freshEmail())).toEqual([]);
    });

    it(
      "AC2: createCustomer resolves to a Customer with a non-empty id, that email, and Date createdAt and updatedAt",
      { timeout },
      async () => {
        const payments = await make();
        const email = freshEmail();
        const customer = await payments.createCustomer({ email, idempotencyKey: freshKey() });
        expect(typeof customer.id).toBe("string");
        expect(customer.id).not.toBe("");
        expect(customer.email).toBe(email);
        expect(customer.createdAt).toBeInstanceOf(Date);
        expect(Number.isNaN(customer.createdAt.getTime())).toBe(false);
        expect(customer.updatedAt).toBeInstanceOf(Date);
        expect(Number.isNaN(customer.updatedAt.getTime())).toBe(false);
      },
    );

    it("AC2: after createCustomer, findCustomersByEmail(email) includes that id", { timeout }, async () => {
      const payments = await make();
      const email = freshEmail();
      const customer = await payments.createCustomer({ email, idempotencyKey: freshKey() });
      const found = await searchUntil(payments, email, (cs) => cs.some((c) => c.id === customer.id));
      expect(found.map((c) => c.id)).toContain(customer.id);
    });

    it("AC3: a customer created as Ada.Lovelace+<run>@Example.COM is found by the address in lowercase", { timeout }, async () => {
      const payments = await make();
      const email = `Ada.Lovelace+${randomUUID()}@Example.COM`;
      const customer = await payments.createCustomer({ email, idempotencyKey: freshKey() });
      const lower = email.toLowerCase();
      const found = await searchUntil(payments, lower, (cs) => cs.some((c) => c.id === customer.id));
      expect(found.map((c) => c.id)).toContain(customer.id);
    });

    it(
      "AC4: createCustomer twice with the same idempotencyKey and input resolves to the same id, and the email finds one customer",
      { timeout },
      async () => {
        const payments = await make();
        const input = { email: freshEmail(), idempotencyKey: freshKey() };
        const first = await payments.createCustomer({ ...input });
        const second = await payments.createCustomer({ ...input });
        expect(first.id).not.toBe("");
        expect(second.id).toBe(first.id);
        const found = await searchUntil(payments, input.email, (cs) => cs.length > 0);
        expect(found.map((c) => c.id)).toEqual([first.id]);
      },
    );

    it(
      "AC5: saveCard with Square's ok nonce resolves to a Card: non-empty id and brand, four-digit last4, expMonth 1–12, four-digit expYear",
      { timeout },
      async () => {
        const payments = await make();
        const customer = await payments.createCustomer({ email: freshEmail(), idempotencyKey: freshKey() });
        const card = await payments.saveCard({
          customerId: customer.id,
          sourceId: SQUARE_SANDBOX_VALUES.cardNonceOk,
          idempotencyKey: freshKey(),
        });
        expect(typeof card.id).toBe("string");
        expect(card.id).not.toBe("");
        expect(typeof card.brand).toBe("string");
        expect(card.brand).not.toBe("");
        expect(card.last4).toMatch(/^\d{4}$/);
        expect(Number.isInteger(card.expMonth)).toBe(true);
        expect(card.expMonth).toBeGreaterThanOrEqual(1);
        expect(card.expMonth).toBeLessThanOrEqual(12);
        expect(String(card.expYear)).toMatch(/^\d{4}$/);
      },
    );

    it("AC6: charge of 5000 cents on the card saveCard saved resolves to { outcome: \"paid\", paymentId }", { timeout }, async () => {
      const payments = await make();
      const { customerId, cardId } = await customerWithCard(payments);
      const result = await payments.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: freshKey() });
      expect(result).toEqual({ outcome: "paid", paymentId: expect.any(String) });
      expect(result.paymentId).not.toBe("");
    });

    it(
      "AC7: charge on Square's declining card-on-file id resolves, not rejects, to { outcome: \"declined\", code } with a non-empty code",
      { timeout },
      async () => {
        const payments = await make();
        const customer = await payments.createCustomer({ email: freshEmail(), idempotencyKey: freshKey() });
        const result = await payments.charge({
          customerId: customer.id,
          cardId: SQUARE_SANDBOX_VALUES.cardOnFileDeclined,
          amountCents: 5000,
          idempotencyKey: freshKey(),
        });
        expect(result.outcome).toBe("declined");
        const code = result.outcome === "declined" ? result.code : undefined;
        expect(typeof code).toBe("string");
        expect(code).not.toBe("");
      },
    );

    it("AC8: charge retried with the same idempotencyKey and input resolves to the same paymentId", { timeout }, async () => {
      const payments = await make();
      const { customerId, cardId } = await customerWithCard(payments);
      const input = { customerId, cardId, amountCents: 5000, idempotencyKey: freshKey() };
      const first = await payments.charge({ ...input });
      const second = await payments.charge({ ...input });
      expect(first.outcome).toBe("paid");
      expect(first.paymentId).not.toBe("");
      expect(second).toEqual(first);
    });

    it(
      "AC9: charge with an idempotencyKey already used for a different amountCents rejects with IdempotencyKeyReusedError",
      { timeout },
      async () => {
        const payments = await make();
        const { customerId, cardId } = await customerWithCard(payments);
        const idempotencyKey = freshKey();
        await payments.charge({ customerId, cardId, amountCents: 5000, idempotencyKey });
        const error = await rejectionOf(payments.charge({ customerId, cardId, amountCents: 5100, idempotencyKey }));
        expect(error).toBeInstanceOf(IdempotencyKeyReusedError);
      },
    );

    it("AC6 (issue 56): a customer created with a referenceId is found carrying it", { timeout }, async () => {
      const payments = await make();
      const email = freshEmail();
      const referenceId = randomUUID();
      const customer = await payments.createCustomer({ email, idempotencyKey: freshKey(), referenceId });
      const found = await searchUntil(payments, email, (cs) => cs.some((c) => c.id === customer.id));
      expect(found.find((c) => c.id === customer.id)?.referenceId).toBe(referenceId);
    });

    it("AC6 (issue 56): setCustomerReference gives a customer made without one its referenceId", { timeout }, async () => {
      const payments = await make();
      const email = freshEmail();
      const referenceId = randomUUID();
      const customer = await payments.createCustomer({ email, idempotencyKey: freshKey() });
      await payments.setCustomerReference({ customerId: customer.id, referenceId });
      const found = await searchUntil(payments, email, (cs) => cs.some((c) => c.referenceId === referenceId));
      expect(found.find((c) => c.id === customer.id)?.referenceId).toBe(referenceId);
    });

    it("AC10 (issue 56): findPaymentByReference finds a paid charge made with that referenceId", { timeout }, async () => {
      const payments = await make();
      const { customerId, cardId } = await customerWithCard(payments);
      const referenceId = randomUUID();
      const paid = await payments.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: freshKey(), referenceId });
      expect(paid.outcome).toBe("paid");
      expect(await paymentUntilFound(payments, referenceId)).toEqual({ paymentId: paid.paymentId });
    });

    it("AC10 (issue 56): findPaymentByReference returns null for a referenceId no payment has", { timeout }, async () => {
      const payments = await make();
      const { customerId, cardId } = await customerWithCard(payments);
      await payments.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: freshKey(), referenceId: randomUUID() });
      const since = new Date(Date.now() - 5 * 60_000);
      expect(await payments.findPaymentByReference({ referenceId: randomUUID(), since })).toBeNull();
    });

    it("AC10 (issue 56): a declined charge is never found, so a decline cannot confirm a signup", { timeout }, async () => {
      const payments = await make();
      const customer = await payments.createCustomer({ email: freshEmail(), idempotencyKey: freshKey() });
      const referenceId = randomUUID();
      const declined = await payments.charge({
        customerId: customer.id,
        cardId: SQUARE_SANDBOX_VALUES.cardOnFileDeclined,
        amountCents: 5000,
        idempotencyKey: freshKey(),
        referenceId,
      });
      expect(declined.outcome).toBe("declined");
      const since = new Date(Date.now() - 5 * 60_000);
      expect(await payments.findPaymentByReference({ referenceId, since })).toBeNull();
    });

    it("AC10 (issue 56): a repeated charge key returns the same payment, and the lookup finds that one", { timeout }, async () => {
      const payments = await make();
      const { customerId, cardId } = await customerWithCard(payments);
      const referenceId = randomUUID();
      const input = { customerId, cardId, amountCents: 5000, idempotencyKey: `${referenceId}:1`, referenceId };
      const first = await payments.charge({ ...input });
      const second = await payments.charge({ ...input });
      expect(second).toEqual(first);
      expect(await paymentUntilFound(payments, referenceId)).toEqual({ paymentId: first.paymentId });
    });
  });
}

// ── AC10's input table, shared by src/ports/payments.test.ts and both adapters' tests ──────────

export type PaymentsMethod = "findCustomersByEmail" | "createCustomer" | "saveCard" | "charge";

export const PAYMENTS_METHODS: PaymentsMethod[] = ["findCustomersByEmail", "createCustomer", "saveCard", "charge"];

/** One valid input per method, in the shape `checkPaymentsInput` takes it (the email wrapped in an object). */
export const VALID_PAYMENTS_INPUTS = {
  findCustomersByEmail: { email: "ada@example.com" },
  createCustomer: { email: "ada@example.com", idempotencyKey: "key-1" },
  saveCard: { customerId: "CUSTOMER_1", sourceId: SQUARE_SANDBOX_VALUES.cardNonceOk, idempotencyKey: "key-1" },
  charge: {
    customerId: "CUSTOMER_1",
    cardId: SQUARE_SANDBOX_VALUES.cardOnFileOk,
    amountCents: 5000,
    idempotencyKey: "key-1",
  },
} satisfies Record<PaymentsMethod, object>;

/** Calls `method` on `payments` with an input in `checkPaymentsInput`'s shape. */
export function callPayments(payments: PaymentsPort, method: PaymentsMethod, input: object): Promise<unknown> {
  switch (method) {
    case "findCustomersByEmail":
      return payments.findCustomersByEmail((input as { email: string }).email);
    case "createCustomer":
      return payments.createCustomer(input as Parameters<PaymentsPort["createCustomer"]>[0]);
    case "saveCard":
      return payments.saveCard(input as Parameters<PaymentsPort["saveCard"]>[0]);
    case "charge":
      return payments.charge(input as Parameters<PaymentsPort["charge"]>[0]);
  }
}

export type InputBreach = {
  /** How the case reads in a test name. */
  label: string;
  method: PaymentsMethod;
  /** The port's name for the field, which the RangeError's message must contain. */
  field: string;
  /** Square's snake_case name for it, which the message must not contain. */
  snake: string;
  input: object;
};

const breach = (method: PaymentsMethod, field: string, snake: string, label: string, patch: object): InputBreach => ({
  label: `${method}: ${label}`,
  method,
  field,
  snake,
  input: { ...VALID_PAYMENTS_INPUTS[method], ...patch },
});

/** Every breach AC10 names, on every method that takes the field. */
export const PAYMENTS_INPUT_BREACHES: InputBreach[] = [
  breach("findCustomersByEmail", "email", "email_address", "an empty email", { email: "" }),
  breach("createCustomer", "email", "email_address", "an empty email", { email: "" }),
  breach("createCustomer", "referenceId", "reference_id", "a 41-character referenceId (issue 56)", { referenceId: "r".repeat(41) }),

  ...(["createCustomer", "saveCard", "charge"] as const).flatMap((method) => [
    breach(method, "idempotencyKey", "idempotency_key", "an empty idempotencyKey", { idempotencyKey: "" }),
    breach(method, "idempotencyKey", "idempotency_key", "a 46-character idempotencyKey", { idempotencyKey: "k".repeat(46) }),
  ]),

  breach("saveCard", "customerId", "customer_id", "an empty customerId", { customerId: "" }),
  breach("saveCard", "sourceId", "source_id", "an empty sourceId", { sourceId: "" }),

  breach("charge", "customerId", "customer_id", "an empty customerId", { customerId: "" }),
  breach("charge", "cardId", "source_id", "an empty cardId", { cardId: "" }),
  breach("charge", "referenceId", "reference_id", "a 41-character referenceId", { referenceId: "r".repeat(41) }),
  breach("charge", "amountCents", "amount_money", "amountCents 0", { amountCents: 0 }),
  breach("charge", "amountCents", "amount_money", "amountCents -100", { amountCents: -100 }),
  breach("charge", "amountCents", "amount_money", "amountCents 1.5", { amountCents: 1.5 }),
  breach("charge", "amountCents", "amount_money", "amountCents NaN", { amountCents: Number.NaN }),
  breach("charge", "amountCents", "amount_money", "amountCents Infinity", { amountCents: Number.POSITIVE_INFINITY }),
];
