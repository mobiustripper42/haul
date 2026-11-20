// Issue 222: the phone's three rules, each owned here — what the server keeps (phoneDigits), how a stored phone
// displays (formatPhone), how the box formats while typing (formatPhoneTyping). Their callers get one accepted and
// one refused case each: validateAccountDetails (src/create-account.test.ts), the two actions, the screens and CSVs.
import { describe, expect, it } from "vitest";
import { formatPhone, formatPhoneTyping, phoneDigits } from "./phone.js";

describe("AC1 — phoneDigits keeps ten digits", () => {
  it.each(["(216) 555-1234", "216-555-1234", "216.555.1234", "2165551234", " 216 555 1234 "])(
    "AC1: %j, ten digits once every non-digit is removed, is 2165551234",
    (typed) => {
      expect(phoneDigits(typed)).toBe("2165551234");
    },
  );
});

describe("AC2 — phoneDigits drops the 1 from eleven digits", () => {
  it.each(["+1 216 555 1234", "12165551234", "1 (216) 555-1234"])("AC2: %j, eleven digits starting with 1, is the other ten", (typed) => {
    expect(phoneDigits(typed)).toBe("2165551234");
  });
});

describe("AC3 — phoneDigits refuses anything else", () => {
  it.each([
    ["empty", ""],
    ["no digits", "call me"],
    ["seven digits", "555-1234"],
    ["nine digits", "216-555-123"],
    ["twelve digits", "+1 216 555 12345"],
    ["eleven digits not starting with 1", "2 216 555 1234"],
  ])("AC3: %s (%j) is null", (_what, typed) => {
    expect(phoneDigits(typed)).toBeNull();
  });
});

describe("AC4 — formatPhone", () => {
  it("AC4: ten bare digits read (216) 555-1234", () => {
    expect(formatPhone("2165551234")).toBe("(216) 555-1234");
  });

  it.each(["216-555-0187", "216.555.0134", "(216) 555-0134", "+1 (216) 555-0100", "12165551234", "216555123", "call me", ""])(
    "AC4: %j, not ten bare digits, is returned unchanged",
    (stored) => {
      expect(formatPhone(stored)).toBe(stored);
    },
  );

  it('AC4: null is ""', () => {
    expect(formatPhone(null)).toBe("");
  });
});

describe("AC7 — formatPhoneTyping formats from the digits", () => {
  it.each([
    ["216", "(216"],
    ["216555", "(216) 555"],
    ["2165551", "(216) 555-1"],
    ["2165551234", "(216) 555-1234"],
  ])("AC7: %j reads %j", (typed, shown) => {
    expect(formatPhoneTyping(typed)).toBe(shown);
  });

  it("AC7: a digit typed after formatted text is formatted with the rest: (216) 5551 reads (216) 555-1", () => {
    expect(formatPhoneTyping("(216) 5551")).toBe("(216) 555-1");
  });

  it.each([
    ["1216", "(216"],
    ["12165551234", "(216) 555-1234"],
  ])("AC7: a leading 1 is dropped: %j reads %j", (typed, shown) => {
    expect(formatPhoneTyping(typed)).toBe(shown);
  });

  it.each([
    ["21655512345", "(216) 555-1234"],
    ["(216) 555-12345678", "(216) 555-1234"],
  ])("AC7: a digit past the tenth is ignored: %j reads %j", (typed, shown) => {
    expect(formatPhoneTyping(typed)).toBe(shown);
  });

  it.each(["", "(", "call me"])('AC7: text with no digits, %j, is "", never an opening bracket', (typed) => {
    expect(formatPhoneTyping(typed)).toBe("");
  });
});

describe("AC8 — formatPhoneTyping of a pasted +1 number", () => {
  it("AC8: +1 216 555 1234 reads (216) 555-1234", () => {
    expect(formatPhoneTyping("+1 216 555 1234")).toBe("(216) 555-1234");
  });
});
