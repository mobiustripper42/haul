import {
  checkPaymentsInput,
  IdempotencyKeyReusedError,
  PaymentsError,
  type Card,
  type ChargeResult,
  type Customer,
  type PaymentsPort,
} from "../ports/payments.js";
import type { FetchLike } from "./resend-email.js";

/**
 * The real `PaymentsPort` adapter: Square's REST API on plain `fetch`, no SDK (issue 54). Pinned to
 * one API version, so a version change is a commit, not a dashboard setting.
 */

export const SQUARE_VERSION = "2026-09-16";

export const SQUARE_BASE_URLS: Record<"sandbox" | "production", string> = {
  sandbox: "https://connect.squareupsandbox.com/v2",
  production: "https://connect.squareup.com/v2",
};

/** Square's sandbox test values: the one home for them. */
export const SQUARE_SANDBOX_VALUES = {
  cardNonceOk: "cnon:card-nonce-ok",
  cardOnFileOk: "ccof:customer-card-id-ok",
  cardOnFileDeclined: "ccof:customer-card-id-declined",
} as const;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The first error of Square's `{ errors: [{ category, code, detail }] }` body, each field `""` when the
 * body isn't that shape or isn't JSON, plus `payment.id` when the body carries a payment.
 */
export function readSquareError(body: string): { category: string; code: string; detail: string; paymentId?: string } {
  const parsed = parseJson(body);
  const first = isObject(parsed) && Array.isArray(parsed.errors) ? (parsed.errors[0] as unknown) : undefined;
  const text = (field: string): string => {
    const value = isObject(first) ? first[field] : undefined;
    return typeof value === "string" ? value : "";
  };
  const payment = isObject(parsed) ? parsed.payment : undefined;
  const paymentId = isObject(payment) && typeof payment.id === "string" ? payment.id : undefined;
  return {
    category: text("category"),
    code: text("code"),
    detail: text("detail"),
    ...(paymentId !== undefined && { paymentId }),
  };
}

export class SquarePayments implements PaymentsPort {
  private readonly accessToken: string;
  private readonly locationId: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;

  constructor(options: {
    accessToken: string;
    locationId: string;
    environment: "sandbox" | "production";
    fetch?: FetchLike;
  }) {
    this.accessToken = options.accessToken;
    this.locationId = options.locationId;
    this.baseUrl = SQUARE_BASE_URLS[options.environment];
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  }

  /** Follows Square's cursor until a page has none. */
  async findCustomersByEmail(email: string): Promise<Customer[]> {
    checkPaymentsInput("findCustomersByEmail", { email });
    const customers: Customer[] = [];
    let cursor: string | undefined;
    do {
      const reply = await this.post("/customers/search", {
        query: { filter: { email_address: { exact: email } } },
        limit: 100,
        ...(cursor !== undefined && { cursor }),
      });
      if (!reply.ok) throw errorFor(reply);
      const page = parseObject(reply);
      const found = page.customers ?? [];
      if (!Array.isArray(found)) throw unexpected(reply, "customers");
      customers.push(...found.map((raw: unknown) => toCustomer(reply, raw)));
      cursor = typeof page.cursor === "string" && page.cursor !== "" ? page.cursor : undefined;
    } while (cursor !== undefined);
    return customers;
  }

  async createCustomer(input: {
    email: string;
    idempotencyKey: string;
    givenName?: string;
    familyName?: string;
  }): Promise<Customer> {
    checkPaymentsInput("createCustomer", input);
    const reply = await this.post("/customers", {
      idempotency_key: input.idempotencyKey,
      email_address: input.email,
      ...(input.givenName !== undefined && { given_name: input.givenName }),
      ...(input.familyName !== undefined && { family_name: input.familyName }),
    });
    if (!reply.ok) throw errorFor(reply);
    return toCustomer(reply, parseObject(reply).customer);
  }

  /** A card Square declines to save throws, even on a `PAYMENT_METHOD_ERROR`: the member is on the page. */
  async saveCard(input: {
    customerId: string;
    sourceId: string;
    idempotencyKey: string;
    verificationToken?: string;
  }): Promise<Card> {
    checkPaymentsInput("saveCard", input);
    const reply = await this.post("/cards", {
      idempotency_key: input.idempotencyKey,
      source_id: input.sourceId,
      card: { customer_id: input.customerId },
      ...(input.verificationToken !== undefined && { verification_token: input.verificationToken }),
    });
    if (!reply.ok) throw errorFor(reply);
    const card = parseObject(reply).card;
    if (
      !isObject(card) ||
      typeof card.id !== "string" ||
      typeof card.card_brand !== "string" ||
      typeof card.last_4 !== "string" ||
      typeof card.exp_month !== "number" ||
      typeof card.exp_year !== "number"
    ) {
      throw unexpected(reply, "card");
    }
    return { id: card.id, brand: card.card_brand, last4: card.last_4, expMonth: card.exp_month, expYear: card.exp_year };
  }

  /**
   * A decline is a result, not an exception. Only a payment Square reports `COMPLETED` is paid; a
   * status whose meaning Square's guides don't give throws, so nothing is recorded as paid on it.
   */
  async charge(input: {
    customerId: string;
    cardId: string;
    amountCents: number;
    idempotencyKey: string;
    referenceId?: string;
  }): Promise<ChargeResult> {
    checkPaymentsInput("charge", input);
    const reply = await this.post("/payments", {
      idempotency_key: input.idempotencyKey,
      source_id: input.cardId,
      customer_id: input.customerId,
      location_id: this.locationId,
      amount_money: { amount: input.amountCents, currency: "USD" },
      autocomplete: true,
      ...(input.referenceId !== undefined && { reference_id: input.referenceId }),
    });
    if (!reply.ok) {
      const error = readSquareError(reply.text);
      if (error.category === "PAYMENT_METHOD_ERROR") {
        return {
          outcome: "declined",
          code: error.code,
          ...(error.paymentId !== undefined && { paymentId: error.paymentId }),
        };
      }
      throw errorFor(reply);
    }
    const payment = parseObject(reply).payment;
    if (!isObject(payment) || typeof payment.id !== "string" || typeof payment.status !== "string") {
      throw unexpected(reply, "payment");
    }
    if (payment.status === "COMPLETED") return { outcome: "paid", paymentId: payment.id };
    if (payment.status === "FAILED") return { outcome: "declined", code: "FAILED", paymentId: payment.id };
    throw new PaymentsError({
      status: reply.status,
      category: "",
      code: payment.status,
      detail: `Payment ${payment.id} is ${payment.status}, which is neither COMPLETED nor FAILED`,
    });
  }

  /** One POST. A `fetch` that rejects rejects the call with that same error. */
  private async post(path: string, body: object): Promise<Reply> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, text };
  }
}

type Reply = { ok: boolean; status: number; text: string };

/** The error for a non-2xx: a reused idempotency key is its own class, anything else a `PaymentsError`. */
function errorFor(reply: Reply): PaymentsError {
  const { category, code, detail } = readSquareError(reply.text);
  const fields = { status: reply.status, category, code, detail };
  return reply.status === 400 && code === "IDEMPOTENCY_KEY_REUSED" ? new IdempotencyKeyReusedError(fields) : new PaymentsError(fields);
}

/** A 2xx whose body is not the object Square documents. */
function unexpected(reply: Reply, what: string): PaymentsError {
  return new PaymentsError({ status: reply.status, category: "", code: "", detail: `Square's reply has no usable ${what}` });
}

function parseObject(reply: Reply): JsonObject {
  const parsed = parseJson(reply.text);
  if (!isObject(parsed)) throw unexpected(reply, "body");
  return parsed;
}

function toCustomer(reply: Reply, raw: unknown): Customer {
  if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.created_at !== "string" || typeof raw.updated_at !== "string") {
    throw unexpected(reply, "customer");
  }
  return {
    id: raw.id,
    email: typeof raw.email_address === "string" ? raw.email_address : undefined,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  };
}
