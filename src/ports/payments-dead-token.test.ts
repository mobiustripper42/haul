// Issue 254: isDeadToken, the one home for "Square says the card token is no longer usable". Square's error gives no
// category for these codes, so the code alone decides.
import { describe, expect, it } from "vitest";
import { isDeadToken, PaymentsError } from "./payments.js";

const error = (code: string, category = "INVALID_REQUEST_ERROR"): PaymentsError => new PaymentsError({ status: 400, category, code, detail: "" });

describe("AC8 (issue 254) — isDeadToken", () => {
  it.each(["CARD_TOKEN_EXPIRED", "CARD_TOKEN_USED", "SOURCE_USED", "SOURCE_EXPIRED"])("AC8: a PaymentsError with %s is a dead token, whatever its category", (code) => {
    expect([error(code), error(code, "PAYMENT_METHOD_ERROR"), error(code, "")].map(isDeadToken)).toEqual([true, true, true]);
  });

  it.each<[string, unknown]>([
    ["another code", error("CARD_EXPIRED", "PAYMENT_METHOD_ERROR")],
    ["no code", error("")],
    ["an Error that is not a PaymentsError", Object.assign(new Error("CARD_TOKEN_EXPIRED"), { code: "CARD_TOKEN_EXPIRED" })],
    ["nothing", undefined],
  ])("AC8: %s is not a dead token", (_what, value) => {
    expect(isDeadToken(value)).toBe(false);
  });
});
