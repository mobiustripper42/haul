import {
  checkPaymentsInput,
  IdempotencyKeyReusedError,
  PaymentsError,
  type Card,
  type ChargeResult,
  type Customer,
  type PaymentsPort,
} from "../ports/payments.js";
import { SQUARE_SANDBOX_VALUES } from "./square-payments.js";

/** One resolved charge, paid or declined, as `FakePayments.charges` holds it. */
export type FakeCharge = {
  customerId: string;
  cardId: string;
  amountCents: number;
  idempotencyKey: string;
  referenceId: string | undefined;
  result: ChargeResult;
};

/** The card `saveCard` returns: Square's sandbox test card. */
const FAKE_CARD = { brand: "VISA", last4: "1111", expMonth: 12, expYear: 2030 } as const;

/**
 * The permanent fake (DEC-010) of `PaymentsPort`: an in-process Square that honours Square's sandbox
 * test values and refuses what Square refuses, so one contract suite runs unchanged against it and
 * against `SquarePayments`. It finds emails regardless of case, as Square's search does.
 */
export class FakePayments implements PaymentsPort {
  private readonly customerList: Customer[] = [];
  private readonly cardList: { customerId: string; card: Card }[] = [];
  private readonly chargeList: FakeCharge[] = [];
  private readonly declined = new Map<string, string>();
  private readonly seen = new Map<string, { fingerprint: string; result: unknown }>();
  private nextFailure: Error | undefined;
  private sequence = 0;

  /** Puts a customer in the directory as if the farm had made it in Square. */
  addCustomer(customer: { email: string; createdAt: Date; updatedAt: Date }): Customer {
    const added: Customer = {
      id: this.nextId("CUSTOMER"),
      email: customer.email,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
    this.customerList.push(added);
    return structuredClone(added);
  }

  /** Makes every later charge to `cardId` decline with `code`. */
  declineCard(cardId: string, code: string): void {
    this.declined.set(cardId, code);
  }

  /** Makes the next call of any method reject with `error`, once. */
  failNext(error: Error): void {
    this.nextFailure = error;
  }

  get customers(): Customer[] {
    return structuredClone(this.customerList);
  }

  get cards(): Card[] {
    return structuredClone(this.cardList.map((saved) => saved.card));
  }

  get charges(): FakeCharge[] {
    return structuredClone(this.chargeList);
  }

  async findCustomersByEmail(email: string): Promise<Customer[]> {
    this.begin("findCustomersByEmail", { email });
    const wanted = email.toLowerCase();
    return structuredClone(this.customerList.filter((customer) => customer.email?.toLowerCase() === wanted));
  }

  async createCustomer(input: {
    email: string;
    idempotencyKey: string;
    givenName?: string;
    familyName?: string;
    referenceId?: string;
  }): Promise<Customer> {
    this.begin("createCustomer", input);
    const { email, idempotencyKey, givenName, familyName, referenceId } = input;
    return this.idempotent("createCustomer", idempotencyKey, { email, givenName, familyName, referenceId }, () => {
      const now = new Date();
      const customer: Customer = {
        id: this.nextId("CUSTOMER"),
        email,
        createdAt: now,
        updatedAt: now,
        ...(referenceId !== undefined && { referenceId }),
      };
      this.customerList.push(customer);
      return customer;
    });
  }

  async saveCard(input: {
    customerId: string;
    sourceId: string;
    idempotencyKey: string;
    verificationToken?: string;
  }): Promise<Card> {
    this.begin("saveCard", input);
    const { customerId, sourceId, idempotencyKey, verificationToken } = input;
    return this.idempotent("saveCard", idempotencyKey, { customerId, sourceId, verificationToken }, () => {
      if (!this.customerList.some((customer) => customer.id === customerId)) {
        throw notFound(`Customer ${customerId} not found`);
      }
      const card: Card = { id: this.nextId("ccof:card"), ...FAKE_CARD };
      this.cardList.push({ customerId, card });
      return card;
    });
  }

  async charge(input: {
    customerId: string;
    cardId: string;
    amountCents: number;
    idempotencyKey: string;
    referenceId?: string;
  }): Promise<ChargeResult> {
    this.begin("charge", input);
    const { customerId, cardId, amountCents, idempotencyKey, referenceId } = input;
    return this.idempotent("charge", idempotencyKey, { customerId, cardId, amountCents, referenceId }, () => {
      const result = this.chargeResult(customerId, cardId);
      this.chargeList.push({ customerId, cardId, amountCents, idempotencyKey, referenceId, result });
      return result;
    });
  }

  async setCustomerReference(input: { customerId: string; referenceId: string }): Promise<void> {
    this.begin("setCustomerReference", input);
    const customer = this.customerList.find((candidate) => candidate.id === input.customerId);
    if (customer === undefined) throw notFound(`Customer ${input.customerId} not found`);
    customer.referenceId = input.referenceId;
  }

  /** Paid charges only, as Square's lookup counts COMPLETED ones only. `since` is ignored: `FakeCharge` has no time. */
  async findPaymentByReference(input: { referenceId: string; since: Date }): Promise<{ paymentId: string; amountCents: number } | null> {
    this.begin("findPaymentByReference", input);
    for (const charge of this.chargeList) {
      if (charge.referenceId === input.referenceId && charge.result.outcome === "paid") {
        return { paymentId: charge.result.paymentId, amountCents: charge.amountCents };
      }
    }
    return null;
  }

  /** Every call starts here: input checked first, then a failure `failNext` queued is spent. */
  private begin(method: keyof PaymentsPort, input: object): void {
    checkPaymentsInput(method, input);
    const failure = this.nextFailure;
    if (failure !== undefined) {
      this.nextFailure = undefined;
      throw failure;
    }
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  /** What a charge to `cardId` comes to: the decline `declineCard` set, Square's sandbox ids, or a card saved to this customer. */
  private chargeResult(customerId: string, cardId: string): ChargeResult {
    const code = this.declined.get(cardId);
    if (code !== undefined) return { outcome: "declined", code };
    if (cardId === SQUARE_SANDBOX_VALUES.cardOnFileDeclined) return { outcome: "declined", code: "GENERIC_DECLINE" };
    if (cardId !== SQUARE_SANDBOX_VALUES.cardOnFileOk && !this.cardList.some((saved) => saved.card.id === cardId && saved.customerId === customerId)) {
      throw notFound(`Card ${cardId} not found for customer ${customerId}`);
    }
    return { outcome: "paid", paymentId: this.nextId("PAYMENT") };
  }

  /**
   * The idempotent replay all three writing methods share: the same key with the same input returns the
   * first result and records nothing new; the same key with different input throws, as Square does. A
   * call that throws stores no key.
   */
  private idempotent<T>(method: string, key: string, input: object, run: () => T): T {
    const scope = `${method}:${key}`;
    const fingerprint = JSON.stringify(input);
    const earlier = this.seen.get(scope);
    if (earlier !== undefined) {
      if (earlier.fingerprint !== fingerprint) {
        throw new IdempotencyKeyReusedError({
          status: 400,
          category: "INVALID_REQUEST_ERROR",
          code: "IDEMPOTENCY_KEY_REUSED",
          detail: "The idempotency key can only be retried with the same request data.",
        });
      }
      return structuredClone(earlier.result as T);
    }
    const result = run();
    this.seen.set(scope, { fingerprint, result: structuredClone(result) });
    return structuredClone(result);
  }
}

function notFound(detail: string): PaymentsError {
  return new PaymentsError({ status: 404, category: "INVALID_REQUEST_ERROR", code: "NOT_FOUND", detail });
}
