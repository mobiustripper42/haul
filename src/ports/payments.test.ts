// Issue 54, AC10 and AC14: the port's own surface — its limits, checkPaymentsInput, and its two errors.
// The adapters' halves of AC10 are in fake-payments.test.ts and square-payments.test.ts.
import { describe, expect, it } from "vitest";
import { PAYMENTS_INPUT_BREACHES, VALID_PAYMENTS_INPUTS } from "../adapters/payments-contract.js";
import {
  checkPaymentsInput,
  IDEMPOTENCY_KEY_MAX,
  IdempotencyKeyReusedError,
  isCardRefusal,
  PaymentsError,
  REFERENCE_ID_MAX,
} from "./payments.js";

/** What `fn` threw, or an Error saying it didn't. */
function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return new Error("did not throw");
}

describe("AC10 (issue 54) — the limits", () => {
  it("AC10: IDEMPOTENCY_KEY_MAX is 45 and REFERENCE_ID_MAX is 40", () => {
    expect(IDEMPOTENCY_KEY_MAX).toBe(45);
    expect(REFERENCE_ID_MAX).toBe(40);
  });
});

describe("AC10 (issue 54) — checkPaymentsInput", () => {
  it.each(PAYMENTS_INPUT_BREACHES.map((b) => [b.label, b] as const))(
    "AC10: %s throws a RangeError naming the port's field, not Square's",
    (_label, breach) => {
      const error = thrownBy(() => checkPaymentsInput(breach.method, breach.input));
      expect(error).toBeInstanceOf(RangeError);
      const message = (error as Error).message;
      expect(message).toContain(breach.field);
      expect(message).not.toContain(breach.snake);
    },
  );

  it("AC10: an amountCents that is not an integer is rethrown with amountCents in the message", () => {
    const error = thrownBy(() => checkPaymentsInput("charge", { ...VALID_PAYMENTS_INPUTS.charge, amountCents: 12.5 }));
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toContain("amountCents");
  });

  it.each([
    ["findCustomersByEmail", VALID_PAYMENTS_INPUTS.findCustomersByEmail],
    ["createCustomer", VALID_PAYMENTS_INPUTS.createCustomer],
    ["createCustomer with both names", { ...VALID_PAYMENTS_INPUTS.createCustomer, givenName: "Ada", familyName: "Lovelace" }],
    ["saveCard", VALID_PAYMENTS_INPUTS.saveCard],
    ["saveCard with a verificationToken", { ...VALID_PAYMENTS_INPUTS.saveCard, verificationToken: "verf-1" }],
    ["charge", VALID_PAYMENTS_INPUTS.charge],
    ["charge with a 1-character idempotencyKey", { ...VALID_PAYMENTS_INPUTS.charge, idempotencyKey: "k" }],
    ["charge with a 45-character idempotencyKey", { ...VALID_PAYMENTS_INPUTS.charge, idempotencyKey: "k".repeat(45) }],
    ["charge with a 40-character referenceId", { ...VALID_PAYMENTS_INPUTS.charge, referenceId: "r".repeat(40) }],
    ["charge of 1 cent", { ...VALID_PAYMENTS_INPUTS.charge, amountCents: 1 }],
    ["createCustomer with a 40-character referenceId", { ...VALID_PAYMENTS_INPUTS.createCustomer, referenceId: "r".repeat(40) }],
  ] as const)("AC10: accepts a valid input: %s", (label, input) => {
    const method = label.split(" ")[0] as Parameters<typeof checkPaymentsInput>[0];
    expect(() => checkPaymentsInput(method, input)).not.toThrow();
  });
});

describe("AC14 (issue 54) — the port's errors", () => {
  it("AC14: PaymentsError carries the status, category, code and detail it is built with", () => {
    const error = new PaymentsError({ status: 503, category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: "Try later." });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ status: 503, category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: "Try later." });
  });

  it("AC14: IdempotencyKeyReusedError is a PaymentsError and carries the same fields", () => {
    const error = new IdempotencyKeyReusedError({
      status: 400,
      category: "INVALID_REQUEST_ERROR",
      code: "IDEMPOTENCY_KEY_REUSED",
      detail: "The idempotency key can only be retried with the same request data.",
    });
    expect(error).toBeInstanceOf(PaymentsError);
    expect(error).toMatchObject({ status: 400, category: "INVALID_REQUEST_ERROR", code: "IDEMPOTENCY_KEY_REUSED" });
  });
});

describe("AC6 (issue 56) — checkPaymentsInput on setCustomerReference", () => {
  const VALID = { customerId: "CUSTOMER_1", referenceId: "6f1c2a52-8f7e-4c3b-9d0a-1b2c3d4e5f60" };

  it.each([
    ["an empty customerId", "customerId", { ...VALID, customerId: "" }],
    ["a 41-character referenceId", "referenceId", { ...VALID, referenceId: "r".repeat(41) }],
  ])("AC6: %s throws a RangeError naming the port's field", (_label, field, input) => {
    const error = thrownBy(() => checkPaymentsInput("setCustomerReference", input));
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toContain(field);
  });

  it("AC6: a 40-character referenceId is accepted", () => {
    expect(() => checkPaymentsInput("setCustomerReference", { ...VALID, referenceId: "r".repeat(40) })).not.toThrow();
  });
});

// Issue 156: setCustomerEmail is checked as setCustomerReference is, before any request.
describe("AC11 (issue 156) — checkPaymentsInput on setCustomerEmail", () => {
  const VALID = { customerId: "CUSTOMER_1", email: "ada.new@example.com" };

  it.each([
    ["an empty customerId", "customerId", { ...VALID, customerId: "" }],
    ["an empty email", "email", { ...VALID, email: "" }],
  ])("AC11: %s throws a RangeError naming the port's field", (_label, field, input) => {
    const error = thrownBy(() => checkPaymentsInput("setCustomerEmail", input));
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toContain(field);
  });

  it("AC11: a customerId and an email are accepted, which guards the refusals above", () => {
    expect(() => checkPaymentsInput("setCustomerEmail", VALID)).not.toThrow();
  });
});

describe("AC10a (issue 56) — isCardRefusal", () => {
  const error = (category: string) => new PaymentsError({ status: 402, category, code: "CVV_FAILURE", detail: "Declined." });

  it("AC10a: a PaymentsError whose category is PAYMENT_METHOD_ERROR is a refusal", () => {
    expect(isCardRefusal(error("PAYMENT_METHOD_ERROR"))).toBe(true);
  });

  it.each([
    ["a PaymentsError of another category", error("API_ERROR")],
    ["a reused key", new IdempotencyKeyReusedError({ status: 400, category: "INVALID_REQUEST_ERROR", code: "IDEMPOTENCY_KEY_REUSED", detail: "" })],
    ["a timeout", new DOMException("The operation timed out.", "TimeoutError")],
    ["a plain Error", new Error("PAYMENT_METHOD_ERROR")],
    ["not an error at all", "PAYMENT_METHOD_ERROR"],
    ["nothing", undefined],
  ])("AC10a: %s is not, which guards the refusal above", (_label, value) => {
    expect(isCardRefusal(value)).toBe(false);
  });
});
