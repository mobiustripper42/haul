// Issue 55, AC4–AC7: Create Account's core. validateAccountDetails is the details step's whole rule;
// issueAccountCode is what runs after the response, over the permanent fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { issueAccountCode, validateAccountDetails, type AccountDetails } from "./create-account.js";
import { hashCode, MAX_FAILURES_PER_WINDOW, verifySignInCode } from "./sign-in/code.js";

const VALID = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "216-555-0100", language: "en" };

describe("AC4 — validateAccountDetails", () => {
  it("AC4: valid details are ok, every value as given", () => {
    expect(validateAccountDetails(VALID)).toEqual({ ok: true, details: VALID });
  });

  it("AC4: each value is trimmed", () => {
    const entered = { firstName: "  Ada ", lastName: "\tLovelace", email: " ada@example.com\n", phone: " 216-555-0100 ", language: "es" };
    expect(validateAccountDetails(entered)).toEqual({ ok: true, details: { ...VALID, language: "es" } });
  });

  it.each(["firstName", "lastName", "phone"] as const)("AC4: a missing %s is an error", (field) => {
    expect(validateAccountDetails({ ...VALID, [field]: "" })).toEqual({ ok: false, errors: [field] });
  });

  it.each(["firstName", "lastName", "phone"] as const)("AC4: a %s that is only whitespace is missing", (field) => {
    expect(validateAccountDetails({ ...VALID, [field]: " \t\n " })).toEqual({ ok: false, errors: [field] });
  });

  it("AC4: errors run in form order, whatever failed", () => {
    expect(validateAccountDetails({ firstName: "", lastName: " ", email: "nope", phone: "", language: "en" })).toEqual({
      ok: false,
      errors: ["firstName", "lastName", "email", "phone"],
    });
  });

  it.each([
    ["no @", "name.example.com"],
    ["nothing at all", ""],
    ["only whitespace", "   "],
    ["nothing before the @", "@example.com"],
    ["nothing after the @", "name@"],
    ["two @", "a@b@example.com"],
    ["no . after the @", "name@example"],
    ["whitespace before the @", "na me@example.com"],
    ["whitespace after the @", "name@exa mple.com"],
    ["an empty label before a .", "name@.example.com"],
    ["an empty label after the last .", "name@example."],
    ["an empty label between two .", "name@example..com"],
  ])("AC4: an email with %s is invalid", (_what, email) => {
    expect(validateAccountDetails({ ...VALID, email })).toEqual({ ok: false, errors: ["email"] });
  });

  it.each(["a@b.co", "first.last@sub.example.org", "ADA+box@Example.COM"])("AC4: %s is a valid email", (email) => {
    expect(validateAccountDetails({ ...VALID, email })).toEqual({ ok: true, details: { ...VALID, email } });
  });

  it.each(["fr", "EN", ""])("AC4: language %j is not a language and becomes the default", (language) => {
    expect(validateAccountDetails({ ...VALID, language })).toEqual({ ok: true, details: { ...VALID, language: "en" } });
  });

  /** A well-formed value of exactly `length` characters, so only its length can fail it. */
  const ofLength = (field: "firstName" | "lastName" | "email" | "phone", length: number) =>
    field === "email" ? `${"a".repeat(length - "@example.com".length)}@example.com` : "1".repeat(length);

  it.each([
    ["firstName", 100],
    ["lastName", 100],
    ["email", 254],
    ["phone", 40],
  ] as const)("AC4: %s passes at %i characters after trimming, and fails one past", (field, limit) => {
    const atLimit = ofLength(field, limit);
    expect(validateAccountDetails({ ...VALID, [field]: `  ${atLimit}  ` })).toEqual({ ok: true, details: { ...VALID, [field]: atLimit } });
    expect(validateAccountDetails({ ...VALID, [field]: ofLength(field, limit + 1) })).toEqual({ ok: false, errors: [field] });
  });

  it("AC4: a value too long takes its place in form order, among missing and invalid ones", () => {
    const entered = { firstName: "", lastName: ofLength("lastName", 101), email: "nope", phone: ofLength("phone", 41), language: "en" };
    expect(validateAccountDetails(entered)).toEqual({ ok: false, errors: ["firstName", "lastName", "email", "phone"] });
  });
});

const T0 = new Date("2026-10-28T14:25:30.000Z");
const MINUTE = 60_000;
const DETAILS: AccountDetails = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "216-555-0100", language: "en" };
const CODE = "123456";
const WRONG = "654321";
const PENDING = { code: CODE, codeHash: hashCode(CODE) };
const deps = (now = T0) => ({ now, mintLinkToken: () => "tok" });

describe("AC5–AC7 — issueAccountCode", () => {
  let repo: InMemoryRepository;

  beforeEach(() => {
    repo = new InMemoryRepository();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const unconfirmed = () => repo.createMember({ email: DETAILS.email });
  const confirmed = async () => {
    const member = await repo.createMember({ email: DETAILS.email });
    await repo.confirmMemberEmail(member.id, new Date(T0.getTime() - 60 * MINUTE));
    return member;
  };

  it("AC5: for a new email it saves an unconfirmed member, issues a code and returns both", async () => {
    const { member, outcome } = await issueAccountCode(repo, DETAILS, PENDING, deps());
    expect(outcome).toEqual({ send: "code" });
    expect(member).toMatchObject({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", emailConfirmedAt: null });
    expect(await repo.findMemberByEmail(DETAILS.email)).toEqual(member);
  });

  it("AC5: the code it issued verifies for that member", async () => {
    const { member } = await issueAccountCode(repo, DETAILS, PENDING, deps());
    const result = await verifySignInCode(repo, (email) => repo.findMemberByEmail(email), { email: DETAILS.email, code: CODE }, { now: T0 });
    expect(result).toEqual({ ok: true, subjectId: member.id });
  });

  it("AC5: it runs in one withActor(null)", async () => {
    const withActor = vi.spyOn(repo, "withActor");
    await issueAccountCode(repo, DETAILS, PENDING, deps());
    expect(withActor.mock.calls.map(([actor]) => actor)).toEqual([null]);
  });

  it("AC5: when the code cannot be saved the member is not kept either", async () => {
    const failure = new Error("store down");
    await issueAccountCode(repo, DETAILS, PENDING, deps()); // the partner: this one is kept
    vi.spyOn(repo, "saveSignInCode").mockRejectedValue(failure);
    await expect(issueAccountCode(repo, { ...DETAILS, email: "grace@example.com" }, PENDING, deps())).rejects.toBe(failure);
    expect(await repo.findMemberByEmail("grace@example.com")).toBeNull();
    expect(await repo.findMemberByEmail(DETAILS.email)).not.toBeNull();
  });

  it("AC6: for an unconfirmed member it replaces the details and issues a code", async () => {
    const before = await unconfirmed();
    const { member, outcome } = await issueAccountCode(repo, { ...DETAILS, firstName: "Augusta", language: "es" }, PENDING, deps());
    expect(outcome).toEqual({ send: "code" });
    expect(member).toMatchObject({ id: before.id, firstName: "Augusta", language: "es", emailConfirmedAt: null });
  });

  it("AC6: inside the resend wait the details are still replaced, and nothing is sent", async () => {
    await issueAccountCode(repo, DETAILS, PENDING, deps());
    const { member, outcome } = await issueAccountCode(repo, { ...DETAILS, phone: "216-555-0199" }, PENDING, deps(new Date(T0.getTime() + MINUTE)));
    expect(outcome).toEqual({ send: "nothing" });
    expect(member).toMatchObject({ phone: "216-555-0199" });
  });

  it("AC6: past the resend wait a new code goes", async () => {
    await issueAccountCode(repo, DETAILS, PENDING, deps());
    const { outcome } = await issueAccountCode(repo, DETAILS, PENDING, deps(new Date(T0.getTime() + 10 * MINUTE)));
    expect(outcome).toEqual({ send: "code" });
  });

  it("AC7: for a confirmed member it changes nothing on the member and issues an ordinary code", async () => {
    const before = await confirmed();
    const stored = await repo.findMemberById(before.id);
    const { member, outcome } = await issueAccountCode(repo, { ...DETAILS, firstName: "Mallory", language: "es" }, PENDING, deps());
    expect(outcome).toEqual({ send: "code" });
    expect(member).toEqual(stored);
    expect(await repo.findMemberById(before.id)).toEqual(stored);
  });

  it("AC10: a member locked out of code sign-in gets a link instead, as issueSignInCode says", async () => {
    await issueAccountCode(repo, DETAILS, PENDING, deps());
    for (let guess = 1; guess <= MAX_FAILURES_PER_WINDOW; guess++) {
      await verifySignInCode(repo, (email) => repo.findMemberByEmail(email), { email: DETAILS.email, code: WRONG }, { now: T0 });
    }
    const { outcome } = await issueAccountCode(repo, DETAILS, PENDING, deps(new Date(T0.getTime() + 10 * MINUTE)));
    expect(outcome).toEqual({ send: "link", token: "tok" });
  });
});
