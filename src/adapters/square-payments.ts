import {
  checkPaymentsInput,
  IdempotencyKeyReusedError,
  isCardRefusal,
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

/** How long a Square request may take before it is abandoned. */
export const SQUARE_TIMEOUT_MS = 15_000;

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
  private readonly timeoutMs: number;

  constructor(options: {
    accessToken: string;
    locationId: string;
    environment: "sandbox" | "production";
    fetch?: FetchLike;
    /** Per request; unset means `SQUARE_TIMEOUT_MS`, never no timeout. */
    timeoutMs?: number;
  }) {
    this.accessToken = options.accessToken;
    this.locationId = options.locationId;
    this.baseUrl = SQUARE_BASE_URLS[options.environment];
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? SQUARE_TIMEOUT_MS;
  }

  /** Follows Square's cursor until a page has none. */
  async findCustomersByEmail(email: string): Promise<Customer[]> {
    checkPaymentsInput("findCustomersByEmail", { email });
    const customers: Customer[] = [];
    await this.eachPage(
      "customers",
      (cursor) =>
        this.request("POST", "/customers/search", {
          query: { filter: { email_address: { exact: email } } },
          limit: 100,
          ...(cursor !== undefined && { cursor }),
        }),
      (reply, found) => {
        customers.push(...found.map((raw: unknown) => toCustomer(reply, raw)));
        return false;
      },
    );
    return customers;
  }

  async createCustomer(input: {
    email: string;
    idempotencyKey: string;
    givenName?: string;
    familyName?: string;
    referenceId?: string;
  }): Promise<Customer> {
    checkPaymentsInput("createCustomer", input);
    const reply = await this.request("POST", "/customers", {
      idempotency_key: input.idempotencyKey,
      email_address: input.email,
      ...(input.givenName !== undefined && { given_name: input.givenName }),
      ...(input.familyName !== undefined && { family_name: input.familyName }),
      ...(input.referenceId !== undefined && { reference_id: input.referenceId }),
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
    const reply = await this.request("POST", "/cards", {
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
    const reply = await this.request("POST", "/payments", {
      idempotency_key: input.idempotencyKey,
      source_id: input.cardId,
      customer_id: input.customerId,
      location_id: this.locationId,
      amount_money: { amount: input.amountCents, currency: "USD" },
      autocomplete: true,
      ...(input.referenceId !== undefined && { reference_id: input.referenceId }),
    });
    if (!reply.ok) {
      const failure = errorFor(reply);
      if (isCardRefusal(failure)) {
        const { paymentId } = readSquareError(reply.text);
        return { outcome: "declined", code: failure.code, ...(paymentId !== undefined && { paymentId }) };
      }
      throw failure;
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

  /** Square's `UpdateCustomer`: gives a customer made without one its `reference_id`. */
  async setCustomerReference(input: { customerId: string; referenceId: string }): Promise<void> {
    checkPaymentsInput("setCustomerReference", input);
    const reply = await this.request("PUT", `/customers/${encodeURIComponent(input.customerId)}`, {
      reference_id: input.referenceId,
    });
    if (!reply.ok) throw errorFor(reply);
  }

  /**
   * Square's `ListPayments` from `since` at this location, following the cursor until a COMPLETED
   * payment carries `referenceId`: the rule `charge` has for paid, so a FAILED attempt never confirms a signup.
   * The amount is what Square holds for it, so a confirm can compare it with the ledger.
   */
  async findPaymentByReference(input: { referenceId: string; since: Date }): Promise<{ paymentId: string; amountCents: number } | null> {
    checkPaymentsInput("findPaymentByReference", input);
    let found: { paymentId: string; amountCents: number } | null = null;
    await this.eachPage(
      "payments",
      (cursor) => {
        const query = new URLSearchParams({ begin_time: input.since.toISOString(), location_id: this.locationId });
        if (cursor !== undefined) query.set("cursor", cursor);
        return this.request("GET", `/payments?${query.toString()}`);
      },
      (reply, payments) => {
        for (const raw of payments) {
          if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.status !== "string") throw unexpected(reply, "payment");
          if (raw.status === "COMPLETED" && raw.reference_id === input.referenceId) {
            const amount = isObject(raw.amount_money) ? raw.amount_money.amount : undefined;
            if (typeof amount !== "number") throw unexpected(reply, "payment amount");
            found = { paymentId: raw.id, amountCents: amount };
            return true;
          }
        }
        return false;
      },
    );
    return found;
  }

  /**
   * Follows Square's cursor until a page has none, or `visit` returns true. `key` names the list in the
   * reply; a page may have a cursor and no items.
   */
  private async eachPage(
    key: string,
    request: (cursor: string | undefined) => Promise<Reply>,
    visit: (reply: Reply, items: unknown[]) => boolean,
  ): Promise<void> {
    let cursor: string | undefined;
    do {
      const reply = await request(cursor);
      if (!reply.ok) throw errorFor(reply);
      const page = parseObject(reply);
      const items = page[key] ?? [];
      if (!Array.isArray(items)) throw unexpected(reply, key);
      if (visit(reply, items as unknown[])) return;
      cursor = typeof page.cursor === "string" && page.cursor !== "" ? page.cursor : undefined;
    } while (cursor !== undefined);
  }

  /** One request, abandoned after `timeoutMs`. A `fetch` that rejects rejects the call with that same error. */
  private async request(method: "GET" | "POST" | "PUT", path: string, body?: object): Promise<Reply> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Square-Version": SQUARE_VERSION,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
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
    ...(typeof raw.reference_id === "string" && { referenceId: raw.reference_id }),
  };
}
