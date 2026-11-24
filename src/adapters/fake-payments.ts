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
  /** The card token or saved card's id the charge was made from. */
  sourceId: string;
  amountCents: number;
  idempotencyKey: string;
  referenceId: string | undefined;
  customerInitiated: boolean;
  result: ChargeResult;
};

/** What marks a source as a card token, as Square's sandbox tokens are. */
const TOKEN_PREFIX = "cnon:";

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

  /** Makes every later charge from `sourceId`, a saved card's id or a token, decline with `code`. */
  declineCard(sourceId: string, code: string): void {
    this.declined.set(sourceId, code);
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
      // Square saves a card from a token, or from a payment made from one; nothing else is a source.
      const paidFrom = this.chargeList.find((charge) => charge.result.outcome === "paid" && charge.result.paymentId === sourceId);
      if (paidFrom !== undefined && !paidFrom.sourceId.startsWith(TOKEN_PREFIX)) throw notFound(`Source ${sourceId} not found`);
      if (paidFrom === undefined && !sourceId.startsWith(TOKEN_PREFIX)) throw notFound(`Source ${sourceId} not found`);
      const card: Card = { id: this.nextId("ccof:card"), ...FAKE_CARD };
      this.cardList.push({ customerId: paidFrom?.customerId ?? customerId, card });
      return card;
    });
  }

  async charge(input: {
    customerId: string;
    sourceId: string;
    amountCents: number;
    idempotencyKey: string;
    referenceId?: string;
    customerInitiated: boolean;
  }): Promise<ChargeResult> {
    this.begin("charge", input);
    const { customerId, sourceId, amountCents, idempotencyKey, referenceId, customerInitiated } = input;
    return this.idempotent("charge", idempotencyKey, { customerId, sourceId, amountCents, referenceId, customerInitiated }, () => {
      const result = this.chargeResult(customerId, sourceId);
      this.chargeList.push({ customerId, sourceId, amountCents, idempotencyKey, referenceId, customerInitiated, result });
      return result;
    });
  }

  async setCustomerReference(input: { customerId: string; referenceId: string }): Promise<void> {
    this.begin("setCustomerReference", input);
    const customer = this.customerList.find((candidate) => candidate.id === input.customerId);
    if (customer === undefined) throw notFound(`Customer ${input.customerId} not found`);
    customer.referenceId = input.referenceId;
  }

  async setCustomerEmail(input: { customerId: string; email: string }): Promise<void> {
    this.begin("setCustomerEmail", input);
    const customer = this.customerList.find((candidate) => candidate.id === input.customerId);
    if (customer === undefined) throw notFound(`Customer ${input.customerId} not found`);
    customer.email = input.email;
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

  /**
   * What a charge from `sourceId` comes to: the decline `declineCard` set, Square's sandbox ids, any `cnon:` token, or
   * a card saved to this customer. A token's being single-use is not modelled.
   */
  private chargeResult(customerId: string, sourceId: string): ChargeResult {
    const code = this.declined.get(sourceId);
    if (code !== undefined) return { outcome: "declined", code };
    if (sourceId === SQUARE_SANDBOX_VALUES.cardOnFileDeclined || sourceId === SQUARE_SANDBOX_VALUES.cardNonceDeclined) {
      return { outcome: "declined", code: "GENERIC_DECLINE" };
    }
    if (
      !sourceId.startsWith(TOKEN_PREFIX) &&
      sourceId !== SQUARE_SANDBOX_VALUES.cardOnFileOk &&
      !this.cardList.some((saved) => saved.card.id === sourceId && saved.customerId === customerId)
    ) {
      throw notFound(`Source ${sourceId} not found for customer ${customerId}`);
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
