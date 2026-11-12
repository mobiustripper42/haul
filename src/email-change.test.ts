// Issue 156: requestEmailChange and verifyEmailChange, against an InMemoryRepository and FakePayments. They own the
// code rules — right, wrong, expired, five attempts, replaced, dropped, taken — and the Square step, so their edge
// cases are here; the actions and the page each go through them once accepted and once rejected. What the
// repository stores is src/adapters/email-change-contract.ts's. Whether an address signs in is read through
// sign-in's own request step, which issues a code only for an address a member has.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePayments } from "./adapters/fake-payments.js";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { requestEmailChange, verifyEmailChange } from "./email-change.js";
import type { Member } from "./members.js";
import { PaymentsError } from "./ports/payments.js";
import { CODE_TTL_MS, hashCode, requestSignInCode, verifySignInCode } from "./sign-in/code.js";

const NOW = new Date("2026-11-12T15:00:00.000Z");
const SECOND = 1_000;
const MINUTE = 60_000;
const OLD = "ada@example.com";
const NEW = "ada.new@example.com";
const CODE = "123456";
const WRONG = "654321";

let repo: InMemoryRepository;
let payments: FakePayments;

beforeEach(() => {
  repo = new InMemoryRepository();
  payments = new FakePayments();
});

const at = (ms: number): Date => new Date(NOW.getTime() + ms);

/** Ada, through Create Account and confirmed a month ago. */
const ada = async (): Promise<Member> => {
  const saved = await repo.saveAccount({ email: OLD, firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
  await repo.confirmMemberEmail(saved.id, new Date("2026-10-12T15:00:00.000Z"));
  return reload(saved);
};

const reload = async (member: Member): Promise<Member> => {
  const stored = await repo.findMemberById(member.id);
  if (!stored) throw new Error("the member is gone");
  return stored;
};

/** Ada with a Square customer, as after her first payment; the customer's id. */
const adaInSquare = async (): Promise<{ member: Member; customerId: string }> => {
  const member = await ada();
  const customer = payments.addCustomer({ email: OLD, createdAt: NOW, updatedAt: NOW });
  await repo.setMemberSquareCustomer(member.id, customer.id);
  return { member: await reload(member), customerId: customer.id };
};

const request = (member: Member, newEmail = NEW, code = CODE, now = NOW) => requestEmailChange(repo, member, newEmail, { now, mintCode: () => code });
const verify = (member: Member, code = CODE, now = at(MINUTE)) => verifyEmailChange(repo, payments, member, code, { now });

/** Whether sign-in's request step would issue a code for `email`: it does only for an address a member has. */
const signsIn = async (email: string): Promise<boolean> =>
  (await requestSignInCode(repo, (address) => repo.findMemberByEmail(address), { email, clientKey: null }, { now: NOW, mintCode: () => "000000" }))
    .outcome === "issue";

const INVALID = { ok: false, reason: "invalid" };

describe("AC7 (issue 156) — requestEmailChange", () => {
  it("AC7: it stores a pending change to the new address with the minted code's hash, and gives the code to send", async () => {
    const member = await ada();
    expect(await request(member)).toEqual({ send: "code", code: CODE });
    expect(await repo.findEmailChange(member.id)).toMatchObject({ memberId: member.id, newEmail: NEW, codeHash: hashCode(CODE) });
  });

  it("AC7: the member's email is unchanged", async () => {
    const member = await ada();
    await request(member);
    expect(await repo.findEmailChange(member.id)).not.toBeNull();
    expect((await reload(member)).email).toBe(OLD);
  });
});

describe("AC9 (issue 156) — until the code is confirmed", () => {
  it("AC9: the old address signs in and the new one does not", async () => {
    const member = await ada();
    await request(member);
    expect(await repo.findEmailChange(member.id)).not.toBeNull();
    expect({ old: await signsIn(OLD), new: await signsIn(NEW) }).toEqual({ old: true, new: false });
  });
});

describe("AC10 (issue 156) — the right code within ten minutes", () => {
  it("AC10: it makes the new address the member's email, from the old one", async () => {
    const member = await ada();
    await request(member);
    expect(await verify(member)).toEqual({ ok: true, from: OLD, to: NEW });
    expect((await reload(member)).email).toBe(NEW);
  });

  it("AC10: it marks the new address confirmed at the time of the confirm, and the pending change is gone", async () => {
    const member = await ada();
    await request(member);
    const confirmedAt = at(4 * MINUTE);
    await verify(member, CODE, confirmedAt);
    expect((await reload(member)).emailConfirmedAt).toEqual(confirmedAt);
    expect(await repo.findEmailChange(member.id)).toBeNull();
  });

  it("AC10: 9 minutes 59 seconds after the request, the code still confirms", async () => {
    const member = await ada();
    await request(member);
    expect(await verify(member, CODE, at(CODE_TTL_MS - SECOND))).toEqual({ ok: true, from: OLD, to: NEW });
  });

  it("AC10: afterwards the new address signs in and the old one no longer does", async () => {
    const member = await ada();
    await request(member);
    await verify(member);
    expect({ old: await signsIn(OLD), new: await signsIn(NEW) }).toEqual({ old: false, new: true });
  });
});

describe("AC11 (issue 156) — the Square customer's email", () => {
  it("AC11: a member with a Square customer has that customer's email set to the new address", async () => {
    const { member, customerId } = await adaInSquare();
    await request(member);
    expect(await verify(member)).toEqual({ ok: true, from: OLD, to: NEW });
    expect(payments.customers.find((customer) => customer.id === customerId)?.email).toBe(NEW);
  });

  it.each([
    ["a PaymentsError", new PaymentsError({ status: 503, category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: "Try later." })],
    ["a timeout", new DOMException("The operation timed out.", "TimeoutError")],
  ])("AC11: when Square refuses with %s, it is square and the member's email does not change", async (_label, failure) => {
    const { member } = await adaInSquare();
    await request(member);
    payments.failNext(failure as Error);
    expect(await verify(member)).toEqual({ ok: false, reason: "square" });
    expect((await reload(member)).email).toBe(OLD);
  });

  it("AC11: after Square refuses, the pending change stands and the same right code confirms on a later try", async () => {
    const { member, customerId } = await adaInSquare();
    await request(member);
    payments.failNext(new PaymentsError({ status: 503, category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: "Try later." }));
    await verify(member);
    expect(await repo.findEmailChange(member.id)).not.toBeNull();
    expect(await verify(member, CODE, at(2 * MINUTE))).toEqual({ ok: true, from: OLD, to: NEW });
    expect(payments.customers.find((customer) => customer.id === customerId)?.email).toBe(NEW);
  });

  it("AC11: a member with no Square customer skips Square and is confirmed", async () => {
    const member = await ada();
    await request(member);
    const setEmail = vi.spyOn(payments, "setCustomerEmail");
    expect(await verify(member)).toEqual({ ok: true, from: OLD, to: NEW });
    expect(setEmail).not.toHaveBeenCalled();
  });
});

describe("AC12 (issue 156) — a wrong or expired code", () => {
  it("AC12: a wrong code is invalid and changes nothing: the right one still confirms after it", async () => {
    const member = await ada();
    await request(member);
    expect(await verify(member, WRONG)).toEqual(INVALID);
    expect((await reload(member)).email).toBe(OLD);
    expect(await verify(member)).toEqual({ ok: true, from: OLD, to: NEW });
  });

  it("AC12: ten minutes and a second after the request the right code is invalid and changes nothing; a new code confirms", async () => {
    const member = await ada();
    await request(member);
    expect(await verify(member, CODE, at(CODE_TTL_MS + SECOND))).toEqual(INVALID);
    expect((await reload(member)).email).toBe(OLD);
    await request(member, NEW, "222222", at(CODE_TTL_MS + 2 * SECOND));
    expect(await verify(member, "222222", at(CODE_TTL_MS + 3 * SECOND))).toEqual({ ok: true, from: OLD, to: NEW });
  });

  it("AC12: after four wrong guesses the right code still confirms", async () => {
    const member = await ada();
    await request(member);
    for (let i = 0; i < 4; i++) expect(await verify(member, WRONG)).toEqual(INVALID);
    expect(await verify(member)).toEqual({ ok: true, from: OLD, to: NEW });
  });

  it("AC12: after five wrong guesses the code is dead, the right one included, and only a new code works", async () => {
    const member = await ada();
    await request(member);
    for (let i = 0; i < 5; i++) expect(await verify(member, WRONG)).toEqual(INVALID);
    expect(await verify(member)).toEqual(INVALID);
    expect((await reload(member)).email).toBe(OLD);
    await request(member, NEW, "222222", at(2 * MINUTE));
    expect(await verify(member, "222222", at(3 * MINUTE))).toEqual({ ok: true, from: OLD, to: NEW });
  });

  it("AC12: wrong guesses here never lock the member's sign-in: their sign-in code still signs them in", async () => {
    const member = await ada();
    await repo.saveSignInCode({ subjectId: member.id, codeHash: hashCode("777777"), createdAt: NOW, expiresAt: at(CODE_TTL_MS) });
    await request(member);
    for (let i = 0; i < 6; i++) await verify(member, WRONG);
    const signedIn = await verifySignInCode(repo, (address) => repo.findMemberByEmail(address), { email: OLD, code: "777777" }, { now: at(MINUTE) });
    expect(signedIn).toEqual({ ok: true, subjectId: member.id });
  });

  it("AC12: with no pending change any code is invalid, which guards the confirms above", async () => {
    const member = await ada();
    expect(await verify(member)).toEqual(INVALID);
  });
});

describe("AC13 (issue 156) — Send a new code", () => {
  it("AC13: a new code for the same address replaces the old one: the old code is invalid, the new one confirms", async () => {
    const member = await ada();
    await request(member, NEW, "111111");
    expect(await request(member, NEW, "222222", at(MINUTE))).toEqual({ send: "code", code: "222222" });
    expect(await verify(member, "111111", at(2 * MINUTE))).toEqual(INVALID);
    expect(await verify(member, "222222", at(2 * MINUTE))).toEqual({ ok: true, from: OLD, to: NEW });
  });
});

describe("AC14 (issue 156) — Keep the old email", () => {
  it("AC14: once the pending change is dropped its code is invalid and the email stays", async () => {
    const member = await ada();
    await request(member);
    expect(await repo.findEmailChange(member.id)).not.toBeNull();
    await repo.dropEmailChange(member.id);
    expect(await verify(member)).toEqual(INVALID);
    expect((await reload(member)).email).toBe(OLD);
  });
});

describe("AC15 (issue 156) — an address another member holds", () => {
  it("AC15: at request, the change is stored so the code step shows, and nothing is to be sent", async () => {
    const member = await ada();
    await repo.createMember({ email: NEW });
    expect(await request(member)).toEqual({ send: "nothing" });
    expect(await repo.findEmailChange(member.id)).toMatchObject({ memberId: member.id, newEmail: NEW });
  });

  it("AC15: taken at request, no code confirms it, Square is not called, and the email stays", async () => {
    const { member } = await adaInSquare();
    await repo.createMember({ email: NEW });
    await request(member);
    const setEmail = vi.spyOn(payments, "setCustomerEmail");
    expect(await verify(member)).toEqual(INVALID);
    expect(setEmail).not.toHaveBeenCalled();
    expect((await reload(member)).email).toBe(OLD);
  });

  it("AC15: taken since the request, the right code is invalid, Square is not called, and the email stays", async () => {
    const { member } = await adaInSquare();
    expect(await request(member)).toEqual({ send: "code", code: CODE });
    await repo.createMember({ email: NEW });
    const setEmail = vi.spyOn(payments, "setCustomerEmail");
    expect(await verify(member)).toEqual(INVALID);
    expect(setEmail).not.toHaveBeenCalled();
    expect((await reload(member)).email).toBe(OLD);
  });
});

describe("AC16 (issue 156) — a second change while one is pending", () => {
  it("AC16: it replaces the first: the first code is invalid, and the newest code confirms the newest address", async () => {
    const member = await ada();
    await request(member, NEW, "111111");
    await request(member, "ada.newer@example.com", "222222", at(MINUTE));
    expect(await verify(member, "111111", at(2 * MINUTE))).toEqual(INVALID);
    expect(await verify(member, "222222", at(2 * MINUTE))).toEqual({ ok: true, from: OLD, to: "ada.newer@example.com" });
    expect((await reload(member)).email).toBe("ada.newer@example.com");
  });
});
