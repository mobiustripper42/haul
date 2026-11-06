// Issue 54: SquarePayments over a stubbed fetch — its input check (AC10), the requests it makes
// (AC11), paging (AC12), how it reads Square's replies (AC13) and errors (AC14), and what it never
// leaks (AC15). Nothing here reaches the network; the contract against the real sandbox is
// square-payments.sandbox.ts. Issue 56 adds a customer's reference_id (AC6), the payment lookup (AC10)
// and the timeout on every request (AC12).
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type * as PortModule from "../ports/payments.js";
import { checkPaymentsInput, IdempotencyKeyReusedError, PaymentsError } from "../ports/payments.js";
import {
  callPayments,
  PAYMENTS_INPUT_BREACHES,
  PAYMENTS_METHODS,
  rejectionOf,
  VALID_PAYMENTS_INPUTS,
  type PaymentsMethod,
} from "./payments-contract.js";
import type { FetchLike } from "./resend-email.js";
import { readSquareError, SQUARE_BASE_URLS, SQUARE_SANDBOX_VALUES, SQUARE_VERSION, SquarePayments } from "./square-payments.js";

// checkPaymentsInput keeps its real behaviour; the wrapper only lets AC10 see that the adapter calls it.
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

type Call = { url: string; init: Parameters<FetchLike>[1] };
type Reply = { ok: boolean; status: number; text(): Promise<string> };

/** A fetch that records each call and answers with `replies` in turn, repeating the last. */
function stubFetch(...replies: Reply[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (!reply) throw new Error("stubFetch was given no reply");
    return reply;
  };
  return { fetch, calls };
}

const answer = (status: number, body: string): Reply => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const json = (status: number, body: unknown): Reply => answer(status, JSON.stringify(body));
const bodyOf = (call: Call | undefined): unknown => JSON.parse(call?.init.body ?? "null");

const TOKEN = "EAAAl-test-access-token-SECRET-4f1c";
const LOCATION = "LOCATION_MAIN";

const square = (fetch: FetchLike, environment: "sandbox" | "production" = "sandbox"): SquarePayments =>
  new SquarePayments({ accessToken: TOKEN, locationId: LOCATION, environment, fetch });

// Square's replies, with the extra fields Square sends that the port's types leave out.
const SQ_CUSTOMER = {
  id: "CUS_ADA",
  email_address: "ada@example.com",
  given_name: "Ada",
  created_at: "2026-11-03T14:25:30.123Z",
  updated_at: "2026-11-03T09:40:00-05:00",
  preferences: { email_unsubscribed: false },
  creation_source: "THIRD_PARTY",
  version: 0,
};
const ADA = {
  id: "CUS_ADA",
  email: "ada@example.com",
  createdAt: new Date("2026-11-03T14:25:30.123Z"),
  updatedAt: new Date("2026-11-03T14:40:00.000Z"),
};
const sqCustomer = (id: string) => ({ ...SQ_CUSTOMER, id });
const SQ_CARD = {
  id: "ccof:Abc123",
  card_brand: "VISA",
  last_4: "1111",
  exp_month: 12,
  exp_year: 2030,
  customer_id: "CUS_ADA",
  enabled: true,
  card_type: "CREDIT",
  bin: "411111",
  version: 1,
};
const sqPayment = (status: string) => ({
  payment: { id: "PAY_1", status, amount_money: { amount: 5000, currency: "USD" }, location_id: LOCATION },
});

const PATHS: Record<PaymentsMethod, string> = {
  findCustomersByEmail: "/customers/search",
  createCustomer: "/customers",
  saveCard: "/cards",
  charge: "/payments",
};
const OK_REPLIES: Record<PaymentsMethod, unknown> = {
  findCustomersByEmail: { customers: [SQ_CUSTOMER] },
  createCustomer: { customer: SQ_CUSTOMER },
  saveCard: { card: SQ_CARD },
  charge: sqPayment("COMPLETED"),
};
const okFetch = (method: PaymentsMethod) => stubFetch(json(200, OK_REPLIES[method]));
const call = (payments: SquarePayments, method: PaymentsMethod) => callPayments(payments, method, VALID_PAYMENTS_INPUTS[method]);

const squareError = (category: string, code: string, detail?: string) => ({
  errors: [detail === undefined ? { category, code } : { category, code, detail }],
});

describe("AC10 (issue 54) — SquarePayments checks input first and sends nothing for a breach", () => {
  it.each(PAYMENTS_INPUT_BREACHES.map((b) => [b.label, b] as const))(
    "AC10: %s rejects with a RangeError naming the port's field, and makes no request",
    async (_label, breach) => {
      const { fetch, calls } = okFetch(breach.method);
      const error = await rejectionOf(callPayments(square(fetch), breach.method, breach.input));
      expect(error).toBeInstanceOf(RangeError);
      expect((error as Error).message).toContain(breach.field);
      expect((error as Error).message).not.toContain(breach.snake);
      expect(calls).toHaveLength(0);
    },
  );

  it.each(PAYMENTS_METHODS)("AC10: %s calls checkPaymentsInput with its name and input before any request", async (method) => {
    const sentinel = new Error("checkPaymentsInput refused");
    checkSpy.mockImplementationOnce(() => {
      throw sentinel;
    });
    const { fetch, calls } = okFetch(method);
    const input = VALID_PAYMENTS_INPUTS[method];
    const error = await rejectionOf(callPayments(square(fetch), method, input));
    expect(error).toBe(sentinel);
    expect(checkSpy).toHaveBeenCalledWith(method, input);
    expect(calls).toHaveLength(0);
  });

  it("AC10: a 45-character idempotencyKey and a 40-character referenceId are sent", async () => {
    const { fetch, calls } = okFetch("charge");
    const idempotencyKey = "k".repeat(45);
    const referenceId = "r".repeat(40);
    await square(fetch).charge({ ...VALID_PAYMENTS_INPUTS.charge, idempotencyKey, referenceId });
    expect(calls).toHaveLength(1);
    expect(bodyOf(calls[0])).toMatchObject({ idempotency_key: idempotencyKey, reference_id: referenceId });
  });
});

describe("AC16 (issue 54) — Square's sandbox test values, in their one home", () => {
  it("AC16: SQUARE_SANDBOX_VALUES holds Square's three sandbox test values", () => {
    expect(SQUARE_SANDBOX_VALUES).toStrictEqual({
      cardNonceOk: "cnon:card-nonce-ok",
      cardOnFileOk: "ccof:customer-card-id-ok",
      cardOnFileDeclined: "ccof:customer-card-id-declined",
    });
  });
});

describe("AC11 (issue 54) — SquarePayments' requests", () => {
  it("AC11: SQUARE_VERSION is 2026-09-16", () => {
    expect(SQUARE_VERSION).toBe("2026-09-16");
  });

  it("AC11: SQUARE_BASE_URLS are Square's sandbox and production /v2 bases", () => {
    expect(SQUARE_BASE_URLS).toStrictEqual({
      sandbox: "https://connect.squareupsandbox.com/v2",
      production: "https://connect.squareup.com/v2",
    });
  });

  it.each(
    PAYMENTS_METHODS.flatMap((method) => [
      [method, "sandbox", `https://connect.squareupsandbox.com/v2${PATHS[method]}`] as const,
      [method, "production", `https://connect.squareup.com/v2${PATHS[method]}`] as const,
    ]),
  )("AC11: %s in %s makes exactly one POST to %s", async (method, environment, url) => {
    const { fetch, calls } = okFetch(method);
    await call(square(fetch, environment), method);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(url);
    expect(calls[0]?.init.method).toBe("POST");
  });

  it.each(PAYMENTS_METHODS)("AC11: %s sends Authorization: Bearer <token>, Square-Version and Content-Type", async (method) => {
    const { fetch, calls } = okFetch(method);
    await call(square(fetch), method);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      "Square-Version": "2026-09-16",
      "Content-Type": "application/json",
    });
  });

  it("AC11: findCustomersByEmail sends { query: { filter: { email_address: { exact } } }, limit: 100 }, the email as given", async () => {
    const { fetch, calls } = okFetch("findCustomersByEmail");
    await square(fetch).findCustomersByEmail("Ada.Lovelace@Example.COM");
    expect(bodyOf(calls[0])).toStrictEqual({
      query: { filter: { email_address: { exact: "Ada.Lovelace@Example.COM" } } },
      limit: 100,
    });
  });

  it("AC11: findCustomersByEmail adds cursor on every page after the first, and only there", async () => {
    const { fetch, calls } = stubFetch(
      json(200, { customers: [sqCustomer("CUS_1")], cursor: "CURSOR_1" }),
      json(200, { customers: [sqCustomer("CUS_2")], cursor: "CURSOR_2" }),
      json(200, { customers: [sqCustomer("CUS_3")] }),
    );
    await square(fetch).findCustomersByEmail("ada@example.com");
    const query = { filter: { email_address: { exact: "ada@example.com" } } };
    expect(calls.map(bodyOf)).toStrictEqual([
      { query, limit: 100 },
      { query, limit: 100, cursor: "CURSOR_1" },
      { query, limit: 100, cursor: "CURSOR_2" },
    ]);
    expect(calls.map((c) => c.url)).toStrictEqual(Array(3).fill("https://connect.squareupsandbox.com/v2/customers/search"));
  });

  it("AC11: createCustomer sends { idempotency_key, email_address } and nothing else when no names are given", async () => {
    const { fetch, calls } = okFetch("createCustomer");
    await square(fetch).createCustomer({ email: "Ada@Example.COM", idempotencyKey: "customer-key-1" });
    expect(bodyOf(calls[0])).toStrictEqual({ idempotency_key: "customer-key-1", email_address: "Ada@Example.COM" });
  });

  it("AC11: createCustomer adds given_name and family_name when given", async () => {
    const { fetch, calls } = okFetch("createCustomer");
    await square(fetch).createCustomer({
      email: "ada@example.com",
      idempotencyKey: "customer-key-1",
      givenName: "Ada",
      familyName: "Lovelace",
    });
    expect(bodyOf(calls[0])).toStrictEqual({
      idempotency_key: "customer-key-1",
      email_address: "ada@example.com",
      given_name: "Ada",
      family_name: "Lovelace",
    });
  });

  it("AC11: createCustomer adds only given_name when only givenName is given", async () => {
    const { fetch, calls } = okFetch("createCustomer");
    await square(fetch).createCustomer({ email: "ada@example.com", idempotencyKey: "customer-key-1", givenName: "Ada" });
    expect(bodyOf(calls[0])).toStrictEqual({ idempotency_key: "customer-key-1", email_address: "ada@example.com", given_name: "Ada" });
  });

  it("AC11: createCustomer adds only family_name when only familyName is given", async () => {
    const { fetch, calls } = okFetch("createCustomer");
    await square(fetch).createCustomer({ email: "ada@example.com", idempotencyKey: "customer-key-1", familyName: "Lovelace" });
    expect(bodyOf(calls[0])).toStrictEqual({
      idempotency_key: "customer-key-1",
      email_address: "ada@example.com",
      family_name: "Lovelace",
    });
  });

  it("AC11: saveCard sends { idempotency_key, source_id, card: { customer_id } } and nothing else without a verificationToken", async () => {
    const { fetch, calls } = okFetch("saveCard");
    await square(fetch).saveCard({ customerId: "CUS_ADA", sourceId: "cnon:browser-token", idempotencyKey: "card-key-1" });
    expect(bodyOf(calls[0])).toStrictEqual({
      idempotency_key: "card-key-1",
      source_id: "cnon:browser-token",
      card: { customer_id: "CUS_ADA" },
    });
  });

  it("AC11: saveCard adds verification_token when given", async () => {
    const { fetch, calls } = okFetch("saveCard");
    await square(fetch).saveCard({
      customerId: "CUS_ADA",
      sourceId: "cnon:browser-token",
      idempotencyKey: "card-key-1",
      verificationToken: "verf:buyer-1",
    });
    expect(bodyOf(calls[0])).toStrictEqual({
      idempotency_key: "card-key-1",
      source_id: "cnon:browser-token",
      card: { customer_id: "CUS_ADA" },
      verification_token: "verf:buyer-1",
    });
  });

  it("AC11: charge sends the card as source_id, the location, USD amount_money and autocomplete, and nothing else without a referenceId", async () => {
    const { fetch, calls } = okFetch("charge");
    await square(fetch).charge({ customerId: "CUS_ADA", cardId: "ccof:Abc123", amountCents: 5000, idempotencyKey: "charge-key-1" });
    expect(bodyOf(calls[0])).toStrictEqual({
      idempotency_key: "charge-key-1",
      source_id: "ccof:Abc123",
      customer_id: "CUS_ADA",
      location_id: LOCATION,
      amount_money: { amount: 5000, currency: "USD" },
      autocomplete: true,
    });
  });

  it("AC11: charge adds reference_id when given", async () => {
    const { fetch, calls } = okFetch("charge");
    await square(fetch).charge({
      customerId: "CUS_ADA",
      cardId: "ccof:Abc123",
      amountCents: 1234,
      idempotencyKey: "charge-key-1",
      referenceId: "week-2026-45",
    });
    expect(bodyOf(calls[0])).toStrictEqual({
      idempotency_key: "charge-key-1",
      source_id: "ccof:Abc123",
      customer_id: "CUS_ADA",
      location_id: LOCATION,
      amount_money: { amount: 1234, currency: "USD" },
      autocomplete: true,
      reference_id: "week-2026-45",
    });
  });
});

describe("AC12 (issue 54) — findCustomersByEmail pages", () => {
  it("AC12: follows cursor until a reply has none, and returns every page's customers in reply order", async () => {
    const { fetch, calls } = stubFetch(
      json(200, { customers: [sqCustomer("CUS_1"), sqCustomer("CUS_2")], cursor: "CURSOR_1" }),
      json(200, { customers: [sqCustomer("CUS_3")], cursor: "CURSOR_2" }),
      json(200, { customers: [sqCustomer("CUS_4")] }),
      json(200, { customers: [sqCustomer("CUS_NEVER_ASKED_FOR")] }),
    );
    const found = await square(fetch).findCustomersByEmail("ada@example.com");
    expect(found.map((c) => c.id)).toStrictEqual(["CUS_1", "CUS_2", "CUS_3", "CUS_4"]);
    expect(calls).toHaveLength(3);
  });

  it("AC12: a page with a cursor and no customers is followed", async () => {
    const { fetch, calls } = stubFetch(json(200, { cursor: "CURSOR_1" }), json(200, { customers: [sqCustomer("CUS_1")] }));
    const found = await square(fetch).findCustomersByEmail("ada@example.com");
    expect(found.map((c) => c.id)).toStrictEqual(["CUS_1"]);
    expect(calls).toHaveLength(2);
  });

  it("AC12: a reply of {} is []", async () => {
    const { fetch, calls } = stubFetch(json(200, {}));
    expect(await square(fetch).findCustomersByEmail("ada@example.com")).toStrictEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("AC13 (issue 54) — SquarePayments reads Square's replies", () => {
  it("AC13: findCustomersByEmail maps a customer to { id, email, createdAt, updatedAt }, the RFC 3339 times as Dates", async () => {
    const { fetch } = okFetch("findCustomersByEmail");
    const [customer, ...rest] = await square(fetch).findCustomersByEmail("ada@example.com");
    expect(rest).toHaveLength(0);
    expect(customer).toEqual(ADA);
    expect(customer?.createdAt).toBeInstanceOf(Date);
    expect(customer?.updatedAt.getTime()).toBe(Date.parse("2026-11-03T14:40:00.000Z"));
  });

  it("AC13: createCustomer maps { customer } the same way", async () => {
    const { fetch } = okFetch("createCustomer");
    const customer = await square(fetch).createCustomer({ email: "ada@example.com", idempotencyKey: "customer-key-1" });
    expect(customer).toEqual(ADA);
    expect(customer.createdAt).toBeInstanceOf(Date);
    expect(customer.updatedAt).toBeInstanceOf(Date);
  });

  it("AC13: a customer with no email_address has an email of undefined", async () => {
    const noEmail = Object.fromEntries(Object.entries(SQ_CUSTOMER).filter(([key]) => key !== "email_address"));
    const { fetch } = stubFetch(json(200, { customers: [noEmail] }));
    const [customer] = await square(fetch).findCustomersByEmail("ada@example.com");
    expect(customer).toBeDefined();
    expect(customer?.id).toBe("CUS_ADA");
    expect(customer?.email).toBeUndefined();
  });

  it("AC13: saveCard maps id, card_brand, last_4, exp_month and exp_year to { id, brand, last4, expMonth, expYear }", async () => {
    const { fetch } = okFetch("saveCard");
    const card = await square(fetch).saveCard({ customerId: "CUS_ADA", sourceId: "cnon:browser-token", idempotencyKey: "card-key-1" });
    expect(card).toEqual({ id: "ccof:Abc123", brand: "VISA", last4: "1111", expMonth: 12, expYear: 2030 });
  });

  it("AC13: a COMPLETED payment is { outcome: \"paid\", paymentId }", async () => {
    const { fetch } = stubFetch(json(200, sqPayment("COMPLETED")));
    expect(await call(square(fetch), "charge")).toStrictEqual({ outcome: "paid", paymentId: "PAY_1" });
  });

  it("AC13: a FAILED payment is { outcome: \"declined\", code: \"FAILED\", paymentId }", async () => {
    const { fetch } = stubFetch(json(200, sqPayment("FAILED")));
    expect(await call(square(fetch), "charge")).toStrictEqual({ outcome: "declined", code: "FAILED", paymentId: "PAY_1" });
  });

  it.each(["APPROVED", "PENDING", "CANCELED", "SOME_STATUS_THIS_BUILD_DOES_NOT_KNOW"])(
    "AC13: a %s payment rejects with PaymentsError, never paid",
    async (status) => {
      const { fetch } = stubFetch(json(200, sqPayment(status)));
      const error = await rejectionOf(call(square(fetch), "charge"));
      expect(error).toBeInstanceOf(PaymentsError);
    },
  );
});

describe("AC14 (issue 54) — readSquareError", () => {
  it("AC14: reads the first error's category, code and detail, and payment.id when present", () => {
    const body = JSON.stringify({
      errors: [
        { category: "PAYMENT_METHOD_ERROR", code: "GENERIC_DECLINE", detail: "Authorization error: 'GENERIC_DECLINE'", field: "x" },
        { category: "INVALID_REQUEST_ERROR", code: "SECOND", detail: "second" },
      ],
      payment: { id: "PAY_DECLINED", status: "FAILED" },
    });
    expect(readSquareError(body)).toStrictEqual({
      category: "PAYMENT_METHOD_ERROR",
      code: "GENERIC_DECLINE",
      detail: "Authorization error: 'GENERIC_DECLINE'",
      paymentId: "PAY_DECLINED",
    });
  });

  it("AC14: leaves paymentId out when the body carries no payment", () => {
    const read = readSquareError(JSON.stringify(squareError("AUTHENTICATION_ERROR", "UNAUTHORIZED", "Bad token.")));
    expect(read).toStrictEqual({ category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED", detail: "Bad token." });
  });

  it("AC14: an error with no detail has a detail of \"\"", () => {
    expect(readSquareError(JSON.stringify(squareError("RATE_LIMIT_ERROR", "RATE_LIMITED")))).toStrictEqual({
      category: "RATE_LIMIT_ERROR",
      code: "RATE_LIMITED",
      detail: "",
    });
  });

  it.each([
    ["not JSON", "Service Unavailable"],
    ["empty", ""],
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["an object without errors", '{"message":"upstream timeout"}'],
    ["an empty errors list", '{"errors":[]}'],
    ["errors that is not a list", '{"errors":"bad"}'],
  ])("AC14: a body that is %s reads as empty fields", (_what, body) => {
    expect(readSquareError(body)).toStrictEqual({ category: "", code: "", detail: "" });
  });
});

describe("AC14 (issue 54) — SquarePayments on an error reply", () => {
  const DECLINE = {
    errors: [{ category: "PAYMENT_METHOD_ERROR", code: "CVV_FAILURE", detail: "Authorization error: 'CVV_FAILURE'" }],
    payment: { id: "PAY_DECLINED", status: "FAILED" },
  };

  it("AC14: from charge, a non-2xx whose first error is PAYMENT_METHOD_ERROR resolves to declined with its code and the payment's id", async () => {
    const { fetch } = stubFetch(json(402, DECLINE));
    expect(await call(square(fetch), "charge")).toStrictEqual({
      outcome: "declined",
      code: "CVV_FAILURE",
      paymentId: "PAY_DECLINED",
    });
  });

  it("AC14: from charge, the same decline with no payment in the body has no paymentId", async () => {
    const { fetch } = stubFetch(json(402, squareError("PAYMENT_METHOD_ERROR", "INSUFFICIENT_FUNDS", "Declined.")));
    const result = await call(square(fetch), "charge");
    expect(result).toStrictEqual({ outcome: "declined", code: "INSUFFICIENT_FUNDS" });
  });

  it("AC14: from charge, a PAYMENT_METHOD_ERROR that is not the first error is no decline", async () => {
    const { fetch } = stubFetch(
      json(400, {
        errors: [
          { category: "INVALID_REQUEST_ERROR", code: "INVALID_VALUE", detail: "Bad location." },
          { category: "PAYMENT_METHOD_ERROR", code: "GENERIC_DECLINE" },
        ],
      }),
    );
    const error = await rejectionOf(call(square(fetch), "charge"));
    expect(error).toBeInstanceOf(PaymentsError);
    expect(error).toMatchObject({ status: 400, category: "INVALID_REQUEST_ERROR", code: "INVALID_VALUE" });
  });

  it("AC14: from saveCard, the same PAYMENT_METHOD_ERROR rejects with PaymentsError carrying its category and code", async () => {
    const { fetch } = stubFetch(json(402, DECLINE));
    const error = await rejectionOf(call(square(fetch), "saveCard"));
    expect(error).toBeInstanceOf(PaymentsError);
    expect(error).not.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(error).toMatchObject({ status: 402, category: "PAYMENT_METHOD_ERROR", code: "CVV_FAILURE" });
  });

  it.each(PAYMENTS_METHODS)("AC14: from %s, a 400 IDEMPOTENCY_KEY_REUSED rejects with IdempotencyKeyReusedError", async (method) => {
    const { fetch } = stubFetch(
      json(400, squareError("INVALID_REQUEST_ERROR", "IDEMPOTENCY_KEY_REUSED", "The idempotency key can only be retried with the same request data.")),
    );
    const error = await rejectionOf(call(square(fetch), method));
    expect(error).toBeInstanceOf(IdempotencyKeyReusedError);
  });

  const OTHER_ERRORS = [
    [401, "AUTHENTICATION_ERROR", "UNAUTHORIZED", "This request could not be authorized."],
    [429, "RATE_LIMIT_ERROR", "RATE_LIMITED", "Too many requests."],
    [503, "API_ERROR", "SERVICE_UNAVAILABLE", "Try again later."],
  ] as const;

  it.each(PAYMENTS_METHODS.flatMap((method) => OTHER_ERRORS.map(([status, category, code, detail]) => [method, status, category, code, detail] as const)))(
    "AC14: from %s, a %i rejects with PaymentsError carrying the status and the first error's category, code and detail",
    async (method, status, category, code, detail) => {
      const { fetch } = stubFetch(json(status, squareError(category, code, detail)));
      const error = await rejectionOf(call(square(fetch), method));
      expect(error).toBeInstanceOf(PaymentsError);
      expect(error).not.toBeInstanceOf(IdempotencyKeyReusedError);
      expect(error).toMatchObject({ status, category, code, detail });
    },
  );

  it.each(
    PAYMENTS_METHODS.flatMap((method) => [
      [method, "a body that is not JSON", answer(503, "Service Unavailable")] as const,
      [method, "a JSON body that is not Square's error shape", json(503, { message: "upstream timeout" })] as const,
      [method, "an empty body", answer(503, "")] as const,
      [method, "a body that cannot be read", { ok: false, status: 503, text: () => Promise.reject(new Error("socket hang up")) }] as const,
    ]),
  )("AC14: from %s, a 503 with %s rejects with PaymentsError, status 503 and empty fields", async (method, _what, reply) => {
    const { fetch } = stubFetch(reply);
    const error = await rejectionOf(call(square(fetch), method));
    expect(error).toBeInstanceOf(PaymentsError);
    expect(error).toMatchObject({ status: 503, category: "", code: "", detail: "" });
  });
});

describe("AC15 (issue 54) — SquarePayments leaks no token, and passes a fetch failure through", () => {
  it.each([
    ["a 401", "charge", json(401, squareError("AUTHENTICATION_ERROR", "UNAUTHORIZED", "This request could not be authorized."))],
    ["a 401 that is not JSON", "findCustomersByEmail", answer(401, "Unauthorized")],
    ["a 503 with an empty body", "createCustomer", answer(503, "")],
    ["a saveCard decline", "saveCard", json(402, squareError("PAYMENT_METHOD_ERROR", "CVV_FAILURE", "Declined."))],
    ["an IDEMPOTENCY_KEY_REUSED", "charge", json(400, squareError("INVALID_REQUEST_ERROR", "IDEMPOTENCY_KEY_REUSED"))],
    ["a PENDING payment", "charge", json(200, sqPayment("PENDING"))],
  ] as const)("AC15: the PaymentsError from %s does not contain the access token", async (_what, method, reply) => {
    const { fetch } = stubFetch(reply);
    const error = await rejectionOf(call(square(fetch), method));
    expect(error).toBeInstanceOf(PaymentsError);
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it.each(PAYMENTS_METHODS)("AC15: a fetch that rejects makes %s reject with that very error object", async (method) => {
    const failure = new TypeError("fetch failed");
    const fetch: FetchLike = () => Promise.reject(failure);
    const error = await rejectionOf(call(square(fetch), method));
    expect(error).toBe(failure);
    expect(error).not.toBeInstanceOf(PaymentsError);
  });
});

describe("AC6 (issue 56) — a customer's reference_id", () => {
  it("AC6: createCustomer adds reference_id when given", async () => {
    const { fetch, calls } = okFetch("createCustomer");
    await square(fetch).createCustomer({ email: "ada@example.com", idempotencyKey: "customer-key-1", referenceId: "member-1" });
    expect(bodyOf(calls[0])).toStrictEqual({ idempotency_key: "customer-key-1", email_address: "ada@example.com", reference_id: "member-1" });
  });

  it("AC6: a customer's reference_id maps to referenceId", async () => {
    const { fetch } = stubFetch(json(200, { customers: [{ ...SQ_CUSTOMER, reference_id: "member-1" }] }));
    const [customer] = await square(fetch).findCustomersByEmail("ada@example.com");
    expect(customer?.referenceId).toBe("member-1");
  });

  it("AC6: a 41-character referenceId on createCustomer sends nothing", async () => {
    const { fetch, calls } = okFetch("createCustomer");
    const error = await rejectionOf(square(fetch).createCustomer({ email: "ada@example.com", idempotencyKey: "key", referenceId: "r".repeat(41) }));
    expect(error).toBeInstanceOf(RangeError);
    expect(calls).toHaveLength(0);
  });

  const update = (fetch: FetchLike, environment: "sandbox" | "production" = "sandbox") =>
    square(fetch, environment).setCustomerReference({ customerId: "CUS_ADA", referenceId: "member-1" });

  it("AC6: setCustomerReference makes one PUT to /customers/{customer_id} with reference_id, and resolves to nothing", async () => {
    const { fetch, calls } = stubFetch(json(200, { customer: SQ_CUSTOMER }));
    await expect(update(fetch)).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://connect.squareupsandbox.com/v2/customers/CUS_ADA");
    expect(calls[0]?.init.method).toBe("PUT");
    expect(bodyOf(calls[0])).toMatchObject({ reference_id: "member-1" });
  });

  it("AC6: setCustomerReference goes to production's base in production, with Square's headers", async () => {
    const { fetch, calls } = stubFetch(json(200, { customer: SQ_CUSTOMER }));
    await update(fetch, "production");
    expect(calls[0]?.url).toBe("https://connect.squareup.com/v2/customers/CUS_ADA");
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "Square-Version": "2026-09-16" });
  });

  it("AC6: a non-2xx from setCustomerReference rejects with PaymentsError", async () => {
    const { fetch } = stubFetch(json(404, squareError("INVALID_REQUEST_ERROR", "NOT_FOUND", "No such customer.")));
    expect(await rejectionOf(update(fetch))).toBeInstanceOf(PaymentsError);
  });

  it("AC6: setCustomerReference with a 41-character referenceId sends nothing", async () => {
    const { fetch, calls } = stubFetch(json(200, { customer: SQ_CUSTOMER }));
    const error = await rejectionOf(square(fetch).setCustomerReference({ customerId: "CUS_ADA", referenceId: "r".repeat(41) }));
    expect(error).toBeInstanceOf(RangeError);
    expect(calls).toHaveLength(0);
  });
});

describe("AC10 (issue 56) — findPaymentByReference", () => {
  const SINCE = new Date("2026-11-06T12:00:00.000Z");
  const LEDGER = "ledger-1";
  const listed = (id: string, status: string, reference_id?: string) => ({
    id,
    status,
    location_id: LOCATION,
    amount_money: { amount: 5000, currency: "USD" },
    ...(reference_id !== undefined && { reference_id }),
  });
  const find = (fetch: FetchLike, environment: "sandbox" | "production" = "sandbox") =>
    square(fetch, environment).findPaymentByReference({ referenceId: LEDGER, since: SINCE });

  it("AC10: it sends a GET to /payments with no body, begin_time and location_id in the query", async () => {
    const { fetch, calls } = stubFetch(json(200, { payments: [listed("PAY_1", "COMPLETED", LEDGER)] }));
    await find(fetch);
    const url = new URL(calls[0]?.url ?? "https://nothing.invalid/");
    expect(`${url.origin}${url.pathname}`).toBe("https://connect.squareupsandbox.com/v2/payments");
    expect(Date.parse(url.searchParams.get("begin_time") ?? "")).toBe(SINCE.getTime());
    expect(url.searchParams.get("location_id")).toBe(LOCATION);
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "Square-Version": "2026-09-16" });
  });

  it("AC10: it goes to production's base in production", async () => {
    const { fetch, calls } = stubFetch(json(200, { payments: [listed("PAY_1", "COMPLETED", LEDGER)] }));
    await find(fetch, "production");
    expect(calls[0]?.url.startsWith("https://connect.squareup.com/v2/payments?")).toBe(true);
  });

  it("AC10: it finds the COMPLETED payment carrying the reference_id, among others", async () => {
    const { fetch } = stubFetch(json(200, { payments: [listed("PAY_OTHER", "COMPLETED", "ledger-2"), listed("PAY_BARE", "COMPLETED"), listed("PAY_1", "COMPLETED", LEDGER)] }));
    expect(await find(fetch)).toEqual({ paymentId: "PAY_1" });
  });

  it("AC10: it follows cursor to a later page, sending it there and only there", async () => {
    const { fetch, calls } = stubFetch(
      json(200, { payments: [listed("PAY_OTHER", "COMPLETED", "ledger-2")], cursor: "CURSOR_1" }),
      json(200, { payments: [listed("PAY_1", "COMPLETED", LEDGER)] }),
    );
    expect(await find(fetch)).toEqual({ paymentId: "PAY_1" });
    expect(calls).toHaveLength(2);
    const cursors = calls.map((call) => new URL(call.url).searchParams.get("cursor"));
    expect(cursors).toEqual([null, "CURSOR_1"]);
    expect(new URL(calls[1]?.url ?? "https://nothing.invalid/").searchParams.get("location_id")).toBe(LOCATION);
  });

  it("AC10: a page with a cursor and no payments is followed", async () => {
    const { fetch, calls } = stubFetch(json(200, { cursor: "CURSOR_1" }), json(200, { payments: [listed("PAY_1", "COMPLETED", LEDGER)] }));
    expect(await find(fetch)).toEqual({ paymentId: "PAY_1" });
    expect(calls).toHaveLength(2);
  });

  it("AC10: a reply of {} is null, which guards the finds above", async () => {
    const { fetch } = stubFetch(json(200, {}));
    expect(await find(fetch)).toBeNull();
  });

  it.each(["FAILED", "APPROVED", "PENDING", "CANCELED"])("AC10: a %s payment under the reference is never found, the COMPLETED rule", async (status) => {
    const { fetch, calls } = stubFetch(json(200, { payments: [listed("PAY_1", status, LEDGER)] }));
    expect(await find(fetch)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("AC10: attempt 1's FAILED payment and attempt 2's COMPLETED one, under one reference, give the COMPLETED one", async () => {
    const { fetch } = stubFetch(json(200, { payments: [listed("PAY_ATTEMPT_1", "FAILED", LEDGER), listed("PAY_ATTEMPT_2", "COMPLETED", LEDGER)] }));
    expect(await find(fetch)).toEqual({ paymentId: "PAY_ATTEMPT_2" });
  });

  it("AC10: a non-2xx rejects with PaymentsError, so no charge can follow a failed lookup", async () => {
    const { fetch } = stubFetch(json(503, squareError("API_ERROR", "SERVICE_UNAVAILABLE", "Try later.")));
    expect(await rejectionOf(find(fetch))).toBeInstanceOf(PaymentsError);
  });

  it("AC10: a fetch that rejects rejects the lookup with that very error", async () => {
    const failure = new TypeError("fetch failed");
    expect(await rejectionOf(find(() => Promise.reject(failure)))).toBe(failure);
  });
});

describe("AC12 (issue 56) — every Square request has a timeout", () => {
  type Run = [string, (payments: SquarePayments) => Promise<unknown>, unknown];
  const RUNS: Run[] = [
    ...PAYMENTS_METHODS.map((method): Run => [method, (payments) => call(payments, method), OK_REPLIES[method]]),
    ["setCustomerReference", (payments) => payments.setCustomerReference({ customerId: "CUS_ADA", referenceId: "member-1" }), { customer: SQ_CUSTOMER }],
    ["findPaymentByReference", (payments) => payments.findPaymentByReference({ referenceId: "ledger-1", since: new Date(0) }), { payments: [] }],
  ];
  const settings = { accessToken: TOKEN, locationId: LOCATION, environment: "sandbox" } as const;

  let timeout: MockInstance<typeof AbortSignal.timeout>;
  beforeEach(() => {
    timeout = vi.spyOn(AbortSignal, "timeout");
  });
  afterEach(() => {
    timeout.mockRestore();
  });

  it.each(RUNS)("AC12: %s, built without timeoutMs, passes fetch the signal of AbortSignal.timeout(15_000)", async (_name, run, reply) => {
    const { fetch, calls } = stubFetch(json(200, reply));
    await run(new SquarePayments({ ...settings, fetch }));
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init.signal).toBe(timeout.mock.results[0]?.value);
  });

  it("AC12: timeoutMs: undefined still means 15_000, never no timeout", async () => {
    const { fetch, calls } = okFetch("charge");
    const given = { ...settings, fetch, timeoutMs: undefined } as unknown as ConstructorParameters<typeof SquarePayments>[0];
    await call(new SquarePayments(given), "charge");
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("AC12: a timeoutMs given replaces the default", async () => {
    const { fetch } = okFetch("charge");
    await call(new SquarePayments({ ...settings, fetch, timeoutMs: 2_500 }), "charge");
    expect(timeout).toHaveBeenCalledWith(2_500);
    expect(timeout).not.toHaveBeenCalledWith(15_000);
  });

  it("AC12: a request that hangs rejects when the timeout passes", async () => {
    const hangs: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        const { signal } = init;
        if (!signal) {
          reject(new Error("fetch was given no signal"));
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason as Error));
      });
    const error = await rejectionOf(call(new SquarePayments({ ...settings, fetch: hangs, timeoutMs: 5 }), "charge"));
    expect((error as Error).name).toBe("TimeoutError");
  });
});
