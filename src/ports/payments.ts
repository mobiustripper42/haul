import { assertCents } from "../money.js";

/**
 * The payments port (issue 54; DEC-004, DEC-010). Square's customer directory, cards and payments.
 * `FakePayments` is the permanent fake and the test substrate; `SquarePayments` is the real adapter;
 * one contract suite runs against both (`src/adapters/payments-contract.ts`).
 */

export type Customer = {
  id: string;
  email: string | undefined;
  createdAt: Date;
  updatedAt: Date;
  /** The id Haul gave the customer (the member's), when it has one. */
  referenceId?: string;
};

export type Card = { id: string; brand: string; last4: string; expMonth: number; expYear: number };

/** A decline is a result, not an exception: only `charge` returns one, and only `paid` means paid. */
export type ChargeResult = { outcome: "paid"; paymentId: string } | { outcome: "declined"; code: string; paymentId?: string };

export interface PaymentsPort {
  findCustomersByEmail(email: string): Promise<Customer[]>;
  createCustomer(input: {
    email: string;
    idempotencyKey: string;
    givenName?: string;
    familyName?: string;
    referenceId?: string;
  }): Promise<Customer>;
  saveCard(input: { customerId: string; sourceId: string; idempotencyKey: string; verificationToken?: string }): Promise<Card>;
  charge(input: {
    customerId: string;
    cardId: string;
    amountCents: number;
    idempotencyKey: string;
    referenceId?: string;
  }): Promise<ChargeResult>;
  setCustomerReference(input: { customerId: string; referenceId: string }): Promise<void>;
  /** Issue 156: the customer's email, Haul's match key, set to `email`. */
  setCustomerEmail(input: { customerId: string; email: string }): Promise<void>;
  findPaymentByReference(input: { referenceId: string; since: Date }): Promise<{ paymentId: string; amountCents: number } | null>;
}

/** A provider refused a request. `detail` is the provider's text, so keep the message out of logs that outlive the request. */
export class PaymentsError extends Error {
  readonly status: number;
  readonly category: string;
  readonly code: string;
  readonly detail: string;

  constructor(fields: { status: number; category: string; code: string; detail: string }) {
    const named = [fields.category, fields.code].filter((part) => part !== "").join(" ");
    super(`Payments request failed (${fields.status}${named === "" ? "" : ` ${named}`})${fields.detail === "" ? "" : `: ${fields.detail}`}`);
    this.name = "PaymentsError";
    this.status = fields.status;
    this.category = fields.category;
    this.code = fields.code;
    this.detail = fields.detail;
  }
}

/** An idempotency key was reused with different input. */
export class IdempotencyKeyReusedError extends PaymentsError {
  constructor(fields: { status: number; category: string; code: string; detail: string }) {
    super(fields);
    this.name = "IdempotencyKeyReusedError";
  }
}

/** Whether `error` is a provider refusing the card itself: the one home for the `PAYMENT_METHOD_ERROR` rule. */
export function isCardRefusal(error: unknown): error is PaymentsError {
  return error instanceof PaymentsError && error.category === "PAYMENT_METHOD_ERROR";
}

export const IDEMPOTENCY_KEY_MAX = 45;
export const REFERENCE_ID_MAX = 40;

function requireText(field: string, value: unknown): void {
  if (typeof value !== "string" || value === "") {
    throw new RangeError(`${field} must be a non-empty string`);
  }
}

function requireReference(value: unknown): void {
  if (typeof value !== "string" || value.length > REFERENCE_ID_MAX) {
    throw new RangeError(`referenceId must be at most ${REFERENCE_ID_MAX} characters`);
  }
}

function requireKey(value: unknown): void {
  if (typeof value !== "string" || value.length < 1 || value.length > IDEMPOTENCY_KEY_MAX) {
    throw new RangeError(`idempotencyKey must be 1 to ${IDEMPOTENCY_KEY_MAX} characters`);
  }
}

function requirePositiveCents(value: unknown): void {
  try {
    assertCents(value as number);
  } catch (error) {
    throw new RangeError(`amountCents must be a positive integer number of cents: ${(error as Error).message}`);
  }
  if ((value as number) <= 0) {
    throw new RangeError(`amountCents must be a positive integer number of cents, got ${value as number}`);
  }
}

/**
 * Both adapters call this first, so a breach is the same `RangeError` from either, naming the port's
 * field (never Square's snake_case) and before any request. `input` is the method's argument; for
 * `findCustomersByEmail` that is `{ email }`.
 */
export function checkPaymentsInput(method: keyof PaymentsPort, input: object): void {
  const fields = input as Record<string, unknown>;
  switch (method) {
    case "findCustomersByEmail":
      requireText("email", fields.email);
      break;
    case "createCustomer":
      requireText("email", fields.email);
      requireKey(fields.idempotencyKey);
      if (fields.referenceId !== undefined) requireReference(fields.referenceId);
      break;
    case "setCustomerReference":
      requireText("customerId", fields.customerId);
      requireText("referenceId", fields.referenceId);
      requireReference(fields.referenceId);
      break;
    case "setCustomerEmail":
      requireText("customerId", fields.customerId);
      requireText("email", fields.email);
      break;
    case "saveCard":
      requireText("customerId", fields.customerId);
      requireText("sourceId", fields.sourceId);
      requireKey(fields.idempotencyKey);
      break;
    case "charge":
      requireText("customerId", fields.customerId);
      requireText("cardId", fields.cardId);
      requirePositiveCents(fields.amountCents);
      requireKey(fields.idempotencyKey);
      if (fields.referenceId !== undefined) requireReference(fields.referenceId);
      break;
  }
}
