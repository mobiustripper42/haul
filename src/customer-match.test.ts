// Issue 54, AC18–AC21: spec §7.3's email match on the payments port. The port here is a scripted
// PaymentsPort that serves a directory the test chooses — ids included, so AC20's tie-breaks are
// the test's to set — and records what matchCustomer asked of it. Issue 56, AC6: the match takes the
// member id as `referenceId`, and a customer it creates carries the email only, never a name.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { customerIdempotencyKey, matchCustomer, sha256Key } from "./customer-match.js";
import { IDEMPOTENCY_KEY_MAX, type Customer, type PaymentsPort } from "./ports/payments.js";

type CreateInput = Parameters<PaymentsPort["createCustomer"]>[0];

const CREATED_ID = "CREATED_BY_MATCH";
const MEMBER_ID = "6f1c2a52-8f7e-4c3b-9d0a-1b2c3d4e5f60";

/** A port whose directory is `directory`, searched by exact email, recording each search and create. */
function scriptedPayments(directory: Customer[]): { payments: PaymentsPort; searches: string[]; creates: CreateInput[] } {
  const searches: string[] = [];
  const creates: CreateInput[] = [];
  const payments: PaymentsPort = {
    async findCustomersByEmail(email) {
      searches.push(email);
      return directory.filter((c) => c.email === email).map((c) => ({ ...c }));
    },
    async createCustomer(input) {
      creates.push({ ...input });
      const now = new Date("2026-11-03T12:00:00.000Z");
      return { id: CREATED_ID, email: input.email, createdAt: now, updatedAt: now };
    },
    async saveCard() {
      throw new Error("matchCustomer has no business saving a card");
    },
    async charge() {
      throw new Error("matchCustomer has no business charging");
    },
    async setCustomerReference() {},
    async findPaymentByReference() {
      throw new Error("matchCustomer has no business looking up a payment");
    },
  };
  return { payments, searches, creates };
}

const at = (iso: string): Date => new Date(iso);
const customer = (id: string, updatedAt: string, createdAt: string, email = "ada@example.com"): Customer => ({
  id,
  email,
  createdAt: at(createdAt),
  updatedAt: at(updatedAt),
});

describe("AC18 (issue 54) — no customer has the email", () => {
  it("AC18, AC6 (issue 56): creates one with the normalized email, customerIdempotencyKey(email) and the member id, and no name, and resolves to created", async () => {
    const { payments, creates } = scriptedPayments([]);
    const match = await matchCustomer(payments, { email: "ada@example.com", referenceId: MEMBER_ID });
    expect(creates).toHaveLength(1);
    expect(creates[0]).toStrictEqual({
      email: "ada@example.com",
      idempotencyKey: customerIdempotencyKey("ada@example.com"),
      referenceId: MEMBER_ID,
    });
    expect(match).toStrictEqual({ customerId: CREATED_ID, outcome: "created", duplicates: [] });
  });
});

describe("AC19 (issue 54) — exactly one customer has the email", () => {
  it("AC19: resolves to linked with that id and no duplicates, and creates nothing", async () => {
    const { payments, creates } = scriptedPayments([
      customer("CUS_ADA", "2026-10-15T12:00:00Z", "2026-10-01T12:00:00Z"),
      customer("CUS_GRACE", "2026-10-20T12:00:00Z", "2026-10-02T12:00:00Z", "grace@example.com"),
    ]);
    const match = await matchCustomer(payments, { email: "ada@example.com", referenceId: MEMBER_ID });
    expect(match).toStrictEqual({ customerId: "CUS_ADA", outcome: "linked", duplicates: [] });
    expect(creates).toEqual([]);
  });
});

describe("AC20 (issue 54) — several customers have the email", () => {
  it("AC20: links the latest updatedAt; duplicates hold the rest, latest updatedAt first; nothing is created", async () => {
    const { payments, creates } = scriptedPayments([
      customer("CUS_B", "2026-10-10T12:00:00Z", "2026-01-01T00:00:00Z"),
      customer("CUS_C", "2026-10-30T12:00:00Z", "2026-01-01T00:00:00Z"),
      customer("CUS_A", "2026-10-01T12:00:00Z", "2026-01-01T00:00:00Z"),
      customer("CUS_D", "2026-10-20T12:00:00Z", "2026-01-01T00:00:00Z"),
    ]);
    const match = await matchCustomer(payments, { email: "ada@example.com", referenceId: MEMBER_ID });
    expect(match).toStrictEqual({ customerId: "CUS_C", outcome: "linked", duplicates: ["CUS_D", "CUS_B", "CUS_A"] });
    expect(creates).toEqual([]);
  });

  it("AC20: an updatedAt tie goes to the latest createdAt", async () => {
    const { payments } = scriptedPayments([
      customer("CUS_A", "2026-10-30T12:00:00Z", "2026-03-01T00:00:00Z"),
      customer("CUS_B", "2026-10-30T12:00:00Z", "2026-09-01T00:00:00Z"),
      customer("CUS_C", "2026-10-30T12:00:00Z", "2026-06-01T00:00:00Z"),
    ]);
    const match = await matchCustomer(payments, { email: "ada@example.com", referenceId: MEMBER_ID });
    expect(match).toStrictEqual({ customerId: "CUS_B", outcome: "linked", duplicates: ["CUS_C", "CUS_A"] });
  });

  it("AC20: an updatedAt and createdAt tie goes to the lesser id", async () => {
    const { payments } = scriptedPayments([
      customer("CUS_Q", "2026-10-30T12:00:00Z", "2026-03-01T00:00:00Z"),
      customer("CUS_M", "2026-10-30T12:00:00Z", "2026-03-01T00:00:00Z"),
      customer("CUS_Z", "2026-10-30T12:00:00Z", "2026-03-01T00:00:00Z"),
    ]);
    const match = await matchCustomer(payments, { email: "ada@example.com", referenceId: MEMBER_ID });
    expect(match).toStrictEqual({ customerId: "CUS_M", outcome: "linked", duplicates: ["CUS_Q", "CUS_Z"] });
  });

  it("AC20: duplicates follow the same order through all three keys at once", async () => {
    const { payments } = scriptedPayments([
      customer("CUS_E", "2026-10-01T12:00:00Z", "2026-01-01T00:00:00Z"),
      customer("CUS_D", "2026-10-20T12:00:00Z", "2026-05-01T00:00:00Z"),
      customer("CUS_C", "2026-10-20T12:00:00Z", "2026-02-01T00:00:00Z"),
      customer("CUS_B", "2026-10-20T12:00:00Z", "2026-02-01T00:00:00Z"),
      customer("CUS_A", "2026-10-30T12:00:00Z", "2026-01-01T00:00:00Z"),
    ]);
    const match = await matchCustomer(payments, { email: "ada@example.com", referenceId: MEMBER_ID });
    expect(match).toStrictEqual({ customerId: "CUS_A", outcome: "linked", duplicates: ["CUS_D", "CUS_B", "CUS_C", "CUS_E"] });
  });
});

describe("AC21 (issue 54) — the email is normalized, and the create key derived from it", () => {
  it("AC21: \"  Ada@Example.COM \" searches for ada@example.com", async () => {
    const { payments, searches } = scriptedPayments([]);
    await matchCustomer(payments, { email: "  Ada@Example.COM ", referenceId: MEMBER_ID });
    expect(searches).toEqual(["ada@example.com"]);
  });

  it("AC21: \"  Ada@Example.COM \" creates ada@example.com, keyed by the normalized email", async () => {
    const { payments, creates } = scriptedPayments([]);
    await matchCustomer(payments, { email: "  Ada@Example.COM ", referenceId: MEMBER_ID });
    expect(creates).toStrictEqual([
      { email: "ada@example.com", idempotencyKey: customerIdempotencyKey("ada@example.com"), referenceId: MEMBER_ID },
    ]);
  });

  it("AC21: \"  Ada@Example.COM \" links the customer stored as ada@example.com", async () => {
    const { payments, creates } = scriptedPayments([customer("CUS_ADA", "2026-10-15T12:00:00Z", "2026-10-01T12:00:00Z")]);
    const match = await matchCustomer(payments, { email: "  Ada@Example.COM ", referenceId: MEMBER_ID });
    expect(match).toStrictEqual({ customerId: "CUS_ADA", outcome: "linked", duplicates: [] });
    expect(creates).toEqual([]);
  });

  it("AC21: customerIdempotencyKey gives the same key for two spellings that normalize alike", () => {
    expect(customerIdempotencyKey("  Ada@Example.COM ")).toBe(customerIdempotencyKey("ada@example.com"));
  });

  it("AC21: customerIdempotencyKey gives different keys for different emails", () => {
    expect(customerIdempotencyKey("ada@example.com")).not.toBe(customerIdempotencyKey("grace@example.com"));
  });

  it("AC21: the key is 43 base64url characters, inside IDEMPOTENCY_KEY_MAX", () => {
    const key = customerIdempotencyKey("ada@example.com");
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX);
  });
});

describe("AC7 (issue 56) — sha256Key, the one home for a hashed key", () => {
  it("AC7: it is the base64url SHA-256 of the text", () => {
    expect(sha256Key("cnon:card-nonce-ok")).toBe(createHash("sha256").update("cnon:card-nonce-ok").digest("base64url"));
  });

  it("AC7: it fits an idempotency key", () => {
    expect(sha256Key("cnon:card-nonce-ok").length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX);
    expect(sha256Key("cnon:card-nonce-ok")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("AC7: customerIdempotencyKey is sha256Key of the normalized email", () => {
    expect(sha256Key("ada@example.com")).toBe(customerIdempotencyKey("  Ada@Example.COM "));
  });
});
