// Issue 254, AC21: isRefusedCharge, the one home for "Square refused the charge outright", as against a lost answer that may
// have charged. Every edge of the rule is here; sendCharge and abandonIfRefused (src/ledger-charge.test.ts) and the two Try
// agains take one case each way. Which codes are a dead token is isDeadToken's (./payments-dead-token.test.ts).
import { describe, expect, it } from "vitest";
import { IdempotencyKeyReusedError, isRefusedCharge, PaymentsError } from "./payments.js";

const error = (status: number, category: string, code = "INVALID_VALUE"): PaymentsError => new PaymentsError({ status, category, code, detail: "" });

describe("AC21 (issue 254) — isRefusedCharge", () => {
  it.each([400, 404, 410, 428, 499])("AC21: an INVALID_REQUEST_ERROR with status %i is a refused charge", (status) => {
    expect(isRefusedCharge(error(status, "INVALID_REQUEST_ERROR"))).toBe(true);
  });

  it.each([
    ["a conflict, 409", 409],
    ["too many requests, 429", 429],
    ["a status below 400", 399],
    ["a server's status, 500", 500],
    ["a server's status, 503", 503],
  ])("AC21: an INVALID_REQUEST_ERROR with %s is not", (_what, status) => {
    expect(isRefusedCharge(error(status, "INVALID_REQUEST_ERROR"))).toBe(false);
  });

  it.each([
    ["an outage", 500, "API_ERROR"],
    ["a rate limit", 429, "RATE_LIMIT_ERROR"],
    ["our own credentials refused", 401, "AUTHENTICATION_ERROR"],
    ["a permission refused", 403, "AUTHENTICATION_ERROR"],
    ["a decline", 402, "PAYMENT_METHOD_ERROR"],
    ["no category", 400, ""],
  ])("AC21: %s is not", (_what, status, category) => {
    expect(isRefusedCharge(error(status, category))).toBe(false);
  });

  it("AC21: a key already used is not, whatever its status and category: the first charge under it may have been taken", () => {
    expect(isRefusedCharge(new IdempotencyKeyReusedError({ status: 400, category: "INVALID_REQUEST_ERROR", code: "IDEMPOTENCY_KEY_REUSED", detail: "" }))).toBe(false);
  });

  it.each(["CARD_TOKEN_EXPIRED", "CARD_TOKEN_USED", "SOURCE_USED", "SOURCE_EXPIRED"])("AC21: a dead token, %s, is one whatever its category and status", (code) => {
    expect([error(400, "INVALID_REQUEST_ERROR", code), error(402, "PAYMENT_METHOD_ERROR", code), error(409, "", code)].map(isRefusedCharge)).toEqual([true, true, true]);
  });

  it.each<[string, unknown]>([
    ["no answer", new DOMException("The operation timed out.", "TimeoutError")],
    ["an Error that is not a PaymentsError", Object.assign(new Error("refused"), { status: 400, category: "INVALID_REQUEST_ERROR", code: "INVALID_VALUE" })],
    ["nothing", undefined],
  ])("AC21: %s is not", (_what, value) => {
    expect(isRefusedCharge(value)).toBe(false);
  });
});
