// Issue 56: signUp, retrySignup and confirmSignup over the two fakes. A provider that gives no answer, a
// reply that gets lost after Square took the money and a write that fails are each made by a spy on one
// method, which falls through to the fake once it is spent. What only Postgres can show (the actor on a
// trigger row, callers racing on a unique index) is in src/adapters/postgres-product.test.ts.
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePayments } from "./adapters/fake-payments.js";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { customerIdempotencyKey, sha256Key } from "./customer-match.js";
import type { Member } from "./members.js";
import { IDEMPOTENCY_KEY_MAX, IdempotencyKeyReusedError, PaymentsError } from "./ports/payments.js";
import { AUDIT_EVENT_KINDS, type PendingSignupInput, type Repository } from "./ports/repository.js";
import type { ProductWithOptions } from "./products.js";
import { confirmSignup, retrySignup, signUp } from "./signup.js";

const NOW = new Date("2026-11-06T15:00:00.000Z");
const LATER = new Date("2026-11-06T15:20:00.000Z");
const EMAIL = "ada@example.com";
const SOURCE = "cnon:card-nonce-ok";
const OTHER_SOURCE = "cnon:another-card";
const CONSENT = "I agree to a weekly charge of $50 until I cancel, and to the Terms and Privacy Policy.";
const SQUARE_TEXT = "Authorization error: the reason Square gave, for member 4242";

let repo: InMemoryRepository;
let payments: FakePayments;
let product: ProductWithOptions;
let member: Member;

beforeEach(async () => {
  repo = new InMemoryRepository();
  payments = new FakePayments();
  product = repo.addProduct({
    name: "Supper Club",
    cap: 50,
    firstPickupDate: "2027-01-03",
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes: [
      {
        name: "How many people?",
        position: 1,
        options: [
          { name: "2 people", priceCents: 5000, position: 1 },
          { name: "3–4 people", priceCents: 8000, position: 2 },
        ],
      },
      {
        name: "Which menu?",
        position: 2,
        options: [
          { name: "Standard", priceCents: 0, position: 1 },
          { name: "Vegan", priceCents: 500, position: 2 },
        ],
      },
    ],
  });
  member = await repo.saveAccount({ email: EMAIL, firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
  await repo.confirmMemberEmail(member.id, NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The picks at these positions; a position the product lacks gives an id that matches nothing. */
const picks = (size = 0, menu = 0): Record<string, string> => {
  const [sizes, menus] = product.optionTypes;
  return {
    [sizes?.id ?? "no size type"]: sizes?.options[size]?.id ?? "no such size",
    [menus?.id ?? "no menu type"]: menus?.options[menu]?.id ?? "no such menu",
  };
};

const deps = (now: Date) => ({ repo, payments, now });

type Submit = { choices: Record<string, string>; sourceId: string; consentText: string; now: Date };

const submit = ({ now = NOW, ...over }: Partial<Submit> = {}) =>
  signUp(deps(now), { memberId: member.id, choices: picks(), sourceId: SOURCE, consentText: CONSENT, ...over });

const retry = (now = LATER) => retrySignup(deps(now), { memberId: member.id });

const pending = () => repo.findPendingSignup(member.id, product.id);
const active = () => repo.findActiveSubscription(member.id, product.id);
const stored = async (): Promise<Member | null> => repo.findMemberById(member.id);
const kinds = () => repo.events().map((event) => event.kind);
const asMember = () => ({ member: member.id });

const noAnswer = (): Error => new DOMException("The operation timed out.", "TimeoutError");
const outage = (): PaymentsError => new PaymentsError({ status: 503, category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: SQUARE_TEXT });
const refused = (code = "CVV_FAILURE"): PaymentsError => new PaymentsError({ status: 402, category: "PAYMENT_METHOD_ERROR", code, detail: SQUARE_TEXT });

/** `times` charges get no answer, and Square took none of them. */
function chargeGetsNoAnswer(times: number) {
  const charge = vi.spyOn(payments, "charge");
  for (let i = 0; i < times; i++) charge.mockRejectedValueOnce(noAnswer());
  return charge;
}

/** `times` charges reach Square, which takes the payment, and the reply is lost on the way back. */
function chargeReplyIsLost(times: number) {
  const real = payments.charge.bind(payments);
  const charge = vi.spyOn(payments, "charge");
  for (let i = 0; i < times; i++) {
    charge.mockImplementationOnce(async (input) => {
      await real(input);
      throw noAnswer();
    });
  }
  return charge;
}

/** The next card saved is one that Square declines to charge. */
function nextCardDeclines(code = "GENERIC_DECLINE") {
  const real = payments.saveCard.bind(payments);
  return vi.spyOn(payments, "saveCard").mockImplementationOnce(async (input) => {
    const card = await real(input);
    payments.declineCard(card.id, code);
    return card;
  });
}

/** A signup that paid, made through the repository alone. */
async function alreadyActive(): Promise<string> {
  const signup = await repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: picks(),
    firstChargeCents: 5000,
    weeklyCents: 5000,
    pickupDate: "2027-01-03",
    consentText: CONSENT,
    consentAt: NOW,
  });
  await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_EARLIER", signup.amountCents, NOW);
  return signup.subscriptionId;
}

/** `other` runs after this tab has saved its card at Square and before it binds it to the row. */
const overtakenBeforeBind = (other: (card: { customerId: string }) => Promise<unknown>) => {
  const save = payments.saveCard.bind(payments);
  vi.spyOn(payments, "saveCard").mockImplementationOnce(async (input) => {
    const card = await save(input);
    await other(input);
    return card;
  });
};

/** Another tab saves its own card at Square and binds it to the row. */
const otherTabBinds = async (customerId: string) => {
  const card = await payments.saveCard({ customerId, sourceId: OTHER_SOURCE, idempotencyKey: sha256Key(OTHER_SOURCE) });
  const row = await pending();
  await repo.saveSubscriptionCard(row?.subscriptionId ?? "no row", card.id);
  return { cardId: card.id, ledgerId: row?.ledgerId ?? "no row" };
};

describe("AC2 — the price", () => {
  it("AC2: the charge is the sum of the picked options, worked out from the option ids", async () => {
    expect((await submit({ choices: picks(1, 1) })).outcome).toBe("paid");
    expect(payments.charges.map((charge) => charge.amountCents)).toEqual([8500]);
  });

  it("AC2: the first charge and the weekly charge are both that sum", async () => {
    await submit({ choices: picks(1, 1) });
    expect(await repo.findSignupConfirmation(member.id, product.id)).toMatchObject({ firstChargeCents: 8500, weeklyCents: 8500 });
  });
});

describe("AC3 — the pickup a signup pays for", () => {
  it("AC3: at 23:59 on Monday 2026-12-28, Cleveland time, the row is for January 3", async () => {
    await submit({ now: new Date("2026-12-29T04:59:00.000Z") });
    expect((await repo.findSignupConfirmation(member.id, product.id))?.pickupDate).toBe("2027-01-03");
  });

  it("AC3: a minute later it is for January 10", async () => {
    await submit({ now: new Date("2026-12-29T05:00:00.000Z") });
    expect((await repo.findSignupConfirmation(member.id, product.id))?.pickupDate).toBe("2027-01-10");
  });
});

describe("AC4 — what a signup records", () => {
  it("AC4: the pending rows carry the consent wording, the amounts, the pickup date and the time", async () => {
    const save = vi.spyOn(repo, "savePendingSignup");
    await submit({ choices: picks(1, 0), consentText: "The wording the page showed." });
    expect(save.mock.calls).toEqual([
      [
        {
          memberId: member.id,
          productId: product.id,
          choices: picks(1, 0),
          firstChargeCents: 8000,
          weeklyCents: 8000,
          pickupDate: "2027-01-03",
          consentText: "The wording the page showed.",
          consentAt: NOW,
        },
      ],
    ]);
  });
});

describe("AC5 — a member who already has a box", () => {
  it("AC5: signUp returns already_subscribed, and asks nothing of Square", async () => {
    const id = await alreadyActive();
    const search = vi.spyOn(payments, "findCustomersByEmail");
    expect(await submit()).toMatchObject({ outcome: "already_subscribed" });
    expect(search).not.toHaveBeenCalled();
    expect(payments.customers).toEqual([]);
    expect(payments.charges).toEqual([]);
    expect(await active()).toEqual({ id });
  });

  it("AC5: it records one already_subscribed event, with no detail, under the member", async () => {
    await alreadyActive();
    await submit();
    expect(repo.events()).toEqual([{ kind: "already_subscribed", memberId: member.id, actor: asMember() }]);
  });

  it("AC5: a pending row is not a subscription: it goes on to a charge", async () => {
    await repo.savePendingSignup({
      memberId: member.id,
      productId: product.id,
      choices: picks(),
      firstChargeCents: 5000,
      weeklyCents: 5000,
      pickupDate: "2027-01-03",
      consentText: CONSENT,
      consentAt: NOW,
    });
    expect((await submit()).outcome).toBe("paid");
  });
});

describe("AC6 — the Square customer", () => {
  it("AC6: with no customer for the email, one is created with the email and the member id, and no name or phone", async () => {
    const create = vi.spyOn(payments, "createCustomer");
    expect((await submit()).outcome).toBe("paid");
    expect(create.mock.calls).toStrictEqual([[{ email: EMAIL, idempotencyKey: customerIdempotencyKey(EMAIL), referenceId: member.id }]]);
  });

  it("AC6: its id is stored on the member", async () => {
    await submit();
    const [customer] = payments.customers;
    expect(customer?.id).toBeDefined();
    expect((await stored())?.squareCustomerId).toBe(customer?.id);
  });

  it("AC6: its reference_id is the member id", async () => {
    await submit();
    expect(payments.customers.map((customer) => customer.referenceId)).toEqual([member.id]);
  });

  it("AC6: creating a customer records no event", async () => {
    expect((await submit()).outcome).toBe("paid");
    expect(repo.events()).toEqual([]);
  });

  describe("one customer has the email", () => {
    let existing: ReturnType<FakePayments["addCustomer"]>;

    beforeEach(() => {
      existing = payments.addCustomer({ email: EMAIL, createdAt: NOW, updatedAt: NOW });
    });

    it("AC6: it is linked, none is created, and its id is stored on the member", async () => {
      expect((await submit()).outcome).toBe("paid");
      expect(payments.customers.map((customer) => customer.id)).toEqual([existing.id]);
      expect((await stored())?.squareCustomerId).toBe(existing.id);
    });

    it("AC6: the member id goes in its reference_id", async () => {
      await submit();
      expect(payments.customers[0]?.referenceId).toBe(member.id);
    });

    it("AC6: a square_customer_linked event records it, with the customer's id, under the member", async () => {
      await submit();
      expect(repo.events()).toEqual([{ kind: "square_customer_linked", memberId: member.id, detail: { customerId: existing.id }, actor: asMember() }]);
    });
  });

  describe("several customers have the email", () => {
    const at = (iso: string) => new Date(iso);
    let oldest: string;
    let newest: string;
    let middle: string;

    beforeEach(() => {
      oldest = payments.addCustomer({ email: EMAIL, createdAt: at("2026-01-01T00:00:00Z"), updatedAt: at("2026-02-01T00:00:00Z") }).id;
      newest = payments.addCustomer({ email: EMAIL, createdAt: at("2026-01-01T00:00:00Z"), updatedAt: at("2026-09-01T00:00:00Z") }).id;
      middle = payments.addCustomer({ email: EMAIL, createdAt: at("2026-01-01T00:00:00Z"), updatedAt: at("2026-05-01T00:00:00Z") }).id;
    });

    it("AC6: the most recently updated is linked and stored", async () => {
      expect((await submit()).outcome).toBe("paid");
      expect((await stored())?.squareCustomerId).toBe(newest);
      expect(payments.charges[0]?.customerId).toBe(newest);
    });

    it("AC6: both square_customer_linked and square_customer_duplicates are recorded, the rest in customerIds", async () => {
      await submit();
      const events = repo.events();
      expect(events).toHaveLength(2);
      expect(events).toEqual(
        expect.arrayContaining([
          { kind: "square_customer_linked", memberId: member.id, detail: { customerId: newest }, actor: asMember() },
          { kind: "square_customer_duplicates", memberId: member.id, detail: { customerIds: [middle, oldest] }, actor: asMember() },
        ]),
      );
    });
  });

  describe("a member with square_customer_id set", () => {
    let customerId: string;

    beforeEach(async () => {
      customerId = payments.addCustomer({ email: EMAIL, createdAt: NOW, updatedAt: NOW }).id;
      await repo.setMemberSquareCustomer(member.id, customerId);
    });

    it("AC6: skips the match: no search, no create, no setCustomerReference, no event", async () => {
      const search = vi.spyOn(payments, "findCustomersByEmail");
      const create = vi.spyOn(payments, "createCustomer");
      const reference = vi.spyOn(payments, "setCustomerReference");
      expect((await submit()).outcome).toBe("paid");
      expect(search).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(reference).not.toHaveBeenCalled();
      expect(repo.events()).toEqual([]);
    });

    it("AC6: the card and the charge go to that customer", async () => {
      await submit();
      expect(payments.charges.map((charge) => charge.customerId)).toEqual([customerId]);
    });
  });

  it("AC6: a second submit after a decline does not repeat the match or its event", async () => {
    payments.addCustomer({ email: EMAIL, createdAt: NOW, updatedAt: NOW });
    nextCardDeclines();
    expect((await submit()).outcome).toBe("declined");
    const search = vi.spyOn(payments, "findCustomersByEmail");
    expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("paid");
    expect(search).not.toHaveBeenCalled();
    expect(kinds().filter((kind) => kind === "square_customer_linked")).toHaveLength(1);
  });
});

describe("AC7 — the rows commit before any charge", () => {
  it("AC7: when the charge is sent, the pending rows are there, with the customer and card ids on them", async () => {
    const real = payments.charge.bind(payments);
    const seen: Array<{ input: Parameters<FakePayments["charge"]>[0]; row: Awaited<ReturnType<typeof pending>>; customerId: string | null | undefined }> = [];
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      seen.push({ input, row: await pending(), customerId: (await stored())?.squareCustomerId });
      return real(input);
    });
    await submit();
    const [at] = seen;
    expect(at?.row).toMatchObject({ ledgerStatus: "pending", attempt: 1, squareCardId: at?.input.cardId });
    expect(at?.customerId).toBe(at?.input.customerId);
  });

  it("AC7: no provider call runs inside a withActor, so a pending row survives a failed call", async () => {
    payments.addCustomer({ email: EMAIL, createdAt: NOW, updatedAt: NOW });
    let open = 0;
    const seen: Array<{ method: string; open: number }> = [];
    const withActor = repo.withActor.bind(repo);
    vi.spyOn(repo, "withActor").mockImplementation(async (actor, fn) => {
      open += 1;
      try {
        return await withActor(actor, fn);
      } finally {
        open -= 1;
      }
    });
    for (const method of ["findCustomersByEmail", "setCustomerReference", "saveCard", "charge"] as const) {
      const real = (payments[method] as (input: unknown) => Promise<unknown>).bind(payments);
      vi.spyOn(payments as unknown as Record<string, (input: unknown) => Promise<unknown>>, method).mockImplementation((input) => {
        seen.push({ method, open });
        return real(input);
      });
    }
    await submit();
    expect(seen.map(({ method }) => method)).toEqual(["findCustomersByEmail", "setCustomerReference", "saveCard", "charge"]);
    expect(seen.filter((call) => call.open !== 0)).toEqual([]);
  });

  it("AC7: the card is saved to the member's customer, its key the SHA-256 of the sourceId, with no verification token", async () => {
    const save = vi.spyOn(payments, "saveCard");
    await submit();
    expect(save.mock.calls).toStrictEqual([[{ customerId: payments.customers[0]?.id, sourceId: SOURCE, idempotencyKey: sha256Key(SOURCE) }]]);
  });

  it("AC9: the charge key is the ledger row plus the attempt, within IDEMPOTENCY_KEY_MAX, and its referenceId the ledger row", async () => {
    const real = payments.charge.bind(payments);
    let ledgerId: string | undefined;
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      ledgerId = (await pending())?.ledgerId;
      return real(input);
    });
    await submit();
    const [charge] = payments.charges;
    expect(ledgerId).toBeDefined();
    expect(charge).toMatchObject({ idempotencyKey: `${ledgerId}:1`, referenceId: ledgerId });
    expect(charge?.idempotencyKey.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX);
  });
});

describe("AC8 — a paid result", () => {
  it("AC8: signUp returns paid and the subscription, and the subscription is active", async () => {
    const result = await submit();
    expect(result.outcome).toBe("paid");
    expect(await active()).toEqual({ id: result.subscriptionId });
    expect(result.subscriptionId).toEqual(expect.any(String));
    expect(await pending()).toBeNull();
  });

  it("AC8: the rows are confirmed with the payment id, at now", async () => {
    const confirm = vi.spyOn(repo, "confirmSignupRows");
    const real = payments.charge.bind(payments);
    let ledgerId: string | undefined;
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      ledgerId = (await pending())?.ledgerId;
      return real(input);
    });
    await submit();
    const [charge] = payments.charges;
    expect(confirm.mock.calls).toEqual([[ledgerId, charge?.result.paymentId, charge?.amountCents, NOW]]);
  });

  it("AC8: it records no event", async () => {
    expect((await submit()).outcome).toBe("paid");
    expect(repo.events()).toEqual([]);
  });
});

describe("AC8 — confirmSignup, the one confirm function", () => {
  const saved = () =>
    repo.savePendingSignup({
      memberId: member.id,
      productId: product.id,
      choices: picks(),
      firstChargeCents: 5000,
      weeklyCents: 5000,
      pickupDate: "2027-01-03",
      consentText: CONSENT,
      consentAt: NOW,
    });

  it('AC8: it returns "confirmed", and a second run returns "already"', async () => {
    const { ledgerId, subscriptionId, amountCents } = await saved();
    expect(await confirmSignup(repo, { ledgerId, paymentId: "PAYMENT_1", amountCents, now: NOW })).toBe("confirmed");
    expect(await confirmSignup(repo, { ledgerId, paymentId: "PAYMENT_1", amountCents, now: NOW })).toBe("already");
    expect(await active()).toEqual({ id: subscriptionId });
  });
});

describe("AC9 — a decline", () => {
  it("AC9: signUp returns declined, nothing is active and the row stays on the ledger as declined", async () => {
    nextCardDeclines();
    expect((await submit()).outcome).toBe("declined");
    expect(await active()).toBeNull();
    expect(await pending()).toMatchObject({ ledgerStatus: "declined", attempt: 1 });
  });

  it("AC9: a card_declined event records the ledger row and the provider's code, under the member, and never Square's text", async () => {
    nextCardDeclines("INSUFFICIENT_FUNDS");
    await submit();
    const ledgerId = (await pending())?.ledgerId;
    expect(ledgerId).toBeDefined();
    expect(repo.events()).toEqual([{ kind: "card_declined", memberId: member.id, detail: { ledgerId, code: "INSUFFICIENT_FUNDS" }, actor: asMember() }]);
  });

  it("AC9: the next submit is attempt 2 on the same rows, under a new key, and pays", async () => {
    nextCardDeclines();
    await submit();
    const declined = await pending();
    expect(declined?.ledgerId).toBeDefined();
    const result = await submit({ sourceId: OTHER_SOURCE });
    expect(result).toMatchObject({ outcome: "paid", subscriptionId: declined?.subscriptionId });
    expect(payments.charges.map((charge) => charge.idempotencyKey)).toEqual([`${declined?.ledgerId}:1`, `${declined?.ledgerId}:2`]);
    expect(payments.charges.map((charge) => charge.result.outcome)).toEqual(["declined", "paid"]);
  });

  it("AC9: the next submit rewrites the picks, the amounts, the consent and the pickup date", async () => {
    nextCardDeclines();
    await submit();
    const save = vi.spyOn(repo, "savePendingSignup");
    const next = new Date("2026-12-29T05:00:00.000Z");
    await submit({ now: next, sourceId: OTHER_SOURCE, choices: picks(1, 1), consentText: "New wording." });
    expect(save.mock.calls[0]?.[0]).toMatchObject({ firstChargeCents: 8500, weeklyCents: 8500, pickupDate: "2027-01-10", consentText: "New wording.", consentAt: next });
    expect(payments.charges.at(-1)?.amountCents).toBe(8500);
    expect(await repo.findSignupConfirmation(member.id, product.id)).toMatchObject({
      pickupDate: "2027-01-10",
      firstChargeCents: 8500,
      options: [
        { typeName: "How many people?", optionName: "3–4 people" },
        { typeName: "Which menu?", optionName: "Vegan" },
      ],
    });
  });

  it("AC9, AC10 (issue 57): AUDIT_EVENT_KINDS holds the six kinds a signup records", () => {
    expect(AUDIT_EVENT_KINDS).toEqual(
      expect.arrayContaining(["already_subscribed", "square_customer_linked", "square_customer_duplicates", "card_declined", "charge_outcome_unknown", "sold_out"]),
    );
  });
});

describe("AC10 — Square gives no answer", () => {
  it("AC10: the server retries once at once with the same key, and a paid result there is paid, with no event", async () => {
    const charge = chargeGetsNoAnswer(1);
    expect((await submit()).outcome).toBe("paid");
    expect(charge).toHaveBeenCalledTimes(2);
    expect(charge.mock.calls[1]?.[0].idempotencyKey).toBe(charge.mock.calls[0]?.[0].idempotencyKey);
    expect(await active()).not.toBeNull();
    expect(repo.events()).toEqual([]);
  });

  it("AC10: when the first reply was lost, the retry gets that payment back and charges once", async () => {
    chargeReplyIsLost(1);
    expect((await submit()).outcome).toBe("paid");
    expect(payments.charges).toHaveLength(1);
  });

  it("AC10: the automatic retry does not ask Square first", async () => {
    chargeGetsNoAnswer(1);
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    await submit();
    expect(lookup).not.toHaveBeenCalled();
    expect(await active()).not.toBeNull();
  });

  it("AC10: with no answer twice, signUp returns unknown after exactly two tries, and the row stays pending with its card", async () => {
    const charge = chargeGetsNoAnswer(2);
    expect((await submit()).outcome).toBe("unknown");
    expect(charge).toHaveBeenCalledTimes(2);
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, squareCardId: expect.any(String) });
    expect(await active()).toBeNull();
  });

  it("AC10: a charge_outcome_unknown event records the ledger row, under the member", async () => {
    chargeGetsNoAnswer(2);
    await submit();
    const ledgerId = (await pending())?.ledgerId;
    expect(ledgerId).toBeDefined();
    expect(repo.events()).toEqual([{ kind: "charge_outcome_unknown", memberId: member.id, detail: { ledgerId }, actor: asMember() }]);
  });

  it("AC10: a charge that throws for any other reason reads as unknown too", async () => {
    vi.spyOn(payments, "charge").mockRejectedValue(outage());
    expect((await submit()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending" });
  });

  it("AC10: an IdempotencyKeyReusedError reads as unknown", async () => {
    const reused = new IdempotencyKeyReusedError({ status: 400, category: "INVALID_REQUEST_ERROR", code: "IDEMPOTENCY_KEY_REUSED", detail: "" });
    vi.spyOn(payments, "charge").mockRejectedValue(reused);
    expect((await submit()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending" });
  });
});

describe('AC10 — "Try again"', () => {
  it("AC10: it asks Square first, with the ledger row and the subscription's created_at", async () => {
    chargeGetsNoAnswer(2);
    await submit();
    const row = await pending();
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    await retry();
    expect(row?.ledgerId).toBeDefined();
    expect(lookup.mock.calls).toEqual([[{ referenceId: row?.ledgerId, since: row?.createdAt }]]);
  });

  it("AC10: a payment found confirms the signup with no charge", async () => {
    const charge = chargeReplyIsLost(2);
    await submit();
    const row = await pending();
    charge.mockClear();
    const confirm = vi.spyOn(repo, "confirmSignupRows");
    const result = await retry();
    expect(result).toMatchObject({ outcome: "paid", subscriptionId: row?.subscriptionId });
    expect(charge).not.toHaveBeenCalled();
    expect(payments.charges).toHaveLength(1);
    expect(confirm.mock.calls).toEqual([[row?.ledgerId, payments.charges[0]?.result.paymentId, payments.charges[0]?.amountCents, LATER]]);
    expect(await active()).toEqual({ id: row?.subscriptionId });
  });

  it("AC10: with none found it charges the saved card and amount under the same key, never a new one, and pays", async () => {
    const charge = chargeGetsNoAnswer(2);
    await submit({ choices: picks(1, 0) });
    const row = await pending();
    const key = charge.mock.calls[0]?.[0].idempotencyKey;
    expect((await retry()).outcome).toBe("paid");
    expect(payments.charges).toHaveLength(1);
    expect(payments.charges[0]).toMatchObject({ idempotencyKey: key, cardId: row?.squareCardId, amountCents: 8000, referenceId: row?.ledgerId });
    expect(await active()).toEqual({ id: row?.subscriptionId });
  });

  it("AC10: it looks before it charges", async () => {
    const charge = chargeGetsNoAnswer(2);
    await submit();
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    await retry();
    expect(lookup.mock.invocationCallOrder[0]).toBeLessThan(charge.mock.invocationCallOrder.at(-1) ?? 0);
    expect(charge).toHaveBeenCalledTimes(3);
  });

  it("AC10: a decline there is a decline: no charge is left owing, and the next submit is attempt 2", async () => {
    nextCardDeclines();
    chargeGetsNoAnswer(2);
    await submit();
    expect((await retry()).outcome).toBe("declined");
    const row = await pending();
    expect(row).toMatchObject({ ledgerStatus: "declined" });
    expect(kinds()).toContain("card_declined");
    expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("paid");
    expect(payments.charges.at(-1)?.idempotencyKey).toBe(`${row?.ledgerId}:2`);
  });

  it("AC10: if the lookup throws, the outcome is unknown and no charge is attempted", async () => {
    const charge = chargeGetsNoAnswer(2);
    await submit();
    charge.mockClear();
    vi.spyOn(payments, "findPaymentByReference").mockRejectedValueOnce(noAnswer());
    expect((await retry()).outcome).toBe("unknown");
    expect(charge).not.toHaveBeenCalled();
    expect(await pending()).toMatchObject({ ledgerStatus: "pending" });
  });

  it("AC10: with still no answer, the outcome is unknown and the row stays for the next try", async () => {
    const real = payments.charge.bind(payments);
    let answering = false;
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      if (!answering) throw noAnswer();
      return real(input);
    });
    await submit();
    expect((await retry()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", squareCardId: expect.any(String) });
    expect(await active()).toBeNull();
    answering = true;
    expect((await retry()).outcome).toBe("paid");
    expect(payments.charges).toHaveLength(1);
  });
});

describe("AC10 — a normal submit on a row in the retry state", () => {
  it("AC10: it rewrites nothing, ignores the picks and the sourceId, and takes the Try again path", async () => {
    chargeGetsNoAnswer(2);
    await submit();
    const row = await pending();
    const save = vi.spyOn(repo, "savePendingSignup");
    const card = vi.spyOn(payments, "saveCard");
    const result = await submit({ choices: picks(1, 1), sourceId: OTHER_SOURCE, consentText: "Other wording." });
    expect(result.outcome).toBe("paid");
    expect(save).not.toHaveBeenCalled();
    expect(card).not.toHaveBeenCalled();
    expect(payments.charges).toHaveLength(1);
    expect(payments.charges[0]).toMatchObject({ amountCents: 5000, cardId: row?.squareCardId });
  });

  it("AC10: when the payment went through, it confirms with no second charge", async () => {
    chargeReplyIsLost(2);
    await submit();
    expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("paid");
    expect(payments.charges).toHaveLength(1);
    expect(await active()).not.toBeNull();
  });
});

describe("AC10a — a failure before the charge", () => {
  const FAILS: Array<[string, () => { mock: { calls: unknown[] } }]> = [
    ["the customer search", () => vi.spyOn(payments, "findCustomersByEmail").mockRejectedValueOnce(outage())],
    ["the customer create", () => vi.spyOn(payments, "createCustomer").mockRejectedValueOnce(outage())],
    [
      "setCustomerReference",
      () => {
        payments.addCustomer({ email: EMAIL, createdAt: NOW, updatedAt: NOW });
        return vi.spyOn(payments, "setCustomerReference").mockRejectedValueOnce(outage());
      },
    ],
    ["storing the customer id", () => vi.spyOn(repo, "setMemberSquareCustomer").mockRejectedValueOnce(new Error("write failed"))],
    ["writing the pending rows", () => vi.spyOn(repo, "savePendingSignup").mockRejectedValueOnce(new Error("write failed"))],
    ["saveCard", () => vi.spyOn(payments, "saveCard").mockRejectedValueOnce(outage())],
    ["storing the card id", () => vi.spyOn(repo, "saveSubscriptionCard").mockRejectedValueOnce(new Error("write failed"))],
  ];

  it.each(FAILS)("AC10a: when %s fails, signUp returns error and nothing is charged", async (_what, fail) => {
    const failing = fail();
    const charge = vi.spyOn(payments, "charge");
    expect((await submit()).outcome).toBe("error");
    expect(failing.mock.calls).toHaveLength(1);
    expect(charge).not.toHaveBeenCalled();
    expect(await active()).toBeNull();
  });

  it.each(FAILS)("AC10a: after %s fails, a resubmit pays, on attempt 1", async (_what, fail) => {
    fail();
    await submit();
    expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("paid");
    expect(payments.charges).toHaveLength(1);
    expect(payments.charges[0]?.idempotencyKey).toMatch(/:1$/);
  });

  it("AC10a: an error before the card is stored leaves no retry state: the card id stays null", async () => {
    vi.spyOn(payments, "saveCard").mockRejectedValueOnce(outage());
    await submit();
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", squareCardId: null });
  });

  it("AC10a: after a decline, a saveCard failure leaves no retry state either: the rewrite nulled the card", async () => {
    nextCardDeclines();
    await submit();
    vi.spyOn(payments, "saveCard").mockRejectedValueOnce(outage());
    expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("error");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 2, squareCardId: null });
  });
});

describe("AC10a — a card Square refuses while saving", () => {
  it("AC10a: it is a decline: no charge, the row declined", async () => {
    vi.spyOn(payments, "saveCard").mockRejectedValueOnce(refused());
    expect((await submit()).outcome).toBe("declined");
    expect(payments.charges).toEqual([]);
    expect(await pending()).toMatchObject({ ledgerStatus: "declined" });
  });

  it("AC10a: card_declined records the error's code and the ledger row, and never Square's text", async () => {
    vi.spyOn(payments, "saveCard").mockRejectedValueOnce(refused("CVV_FAILURE"));
    await submit();
    const ledgerId = (await pending())?.ledgerId;
    expect(ledgerId).toBeDefined();
    expect(repo.events()).toEqual([{ kind: "card_declined", memberId: member.id, detail: { ledgerId, code: "CVV_FAILURE" }, actor: asMember() }]);
  });

  it("AC10a: the next submit is the next attempt", async () => {
    vi.spyOn(payments, "saveCard").mockRejectedValueOnce(refused());
    await submit();
    const ledgerId = (await pending())?.ledgerId;
    expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("paid");
    expect(payments.charges.map((charge) => charge.idempotencyKey)).toEqual([`${ledgerId}:2`]);
  });
});

describe("AC10a — a write that fails after the charge", () => {
  it("AC10a: after a paid charge it is unknown, the row stays pending, and Try again finishes with no second charge", async () => {
    vi.spyOn(repo, "confirmSignupRows").mockRejectedValueOnce(new Error("write failed"));
    expect((await submit()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", squareCardId: expect.any(String) });
    expect(payments.charges).toHaveLength(1);
    expect((await retry()).outcome).toBe("paid");
    expect(payments.charges).toHaveLength(1);
    expect(await active()).not.toBeNull();
  });

  it("AC10a: after a decline it is unknown, and Try again replays the same decline and finishes the write", async () => {
    nextCardDeclines("INSUFFICIENT_FUNDS");
    vi.spyOn(repo, "recordSignupDecline").mockRejectedValueOnce(new Error("write failed"));
    expect((await submit()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending" });
    expect((await retry()).outcome).toBe("declined");
    expect(payments.charges).toHaveLength(1);
    expect(await pending()).toMatchObject({ ledgerStatus: "declined", attempt: 1 });
    expect(await active()).toBeNull();
  });
});

describe("AC11 — a double submit or a second tab", () => {
  it("AC11: a double submit gives one subscription and one charge", async () => {
    const results = await Promise.all([submit(), submit()]);
    expect(results.map((result) => result.outcome)).toContain("paid");
    expect(payments.charges).toHaveLength(1);
    expect(await active()).not.toBeNull();
    expect(payments.customers).toHaveLength(1);
  });

  it("AC11: two tabs with two cards at once share one attempt key: Square takes one charge", async () => {
    const results = await Promise.all([submit(), submit({ sourceId: OTHER_SOURCE })]);
    expect(results.map((result) => result.outcome)).toContain("paid");
    expect(payments.charges).toHaveLength(1);
    expect(await active()).not.toBeNull();
  });

  it("AC11: a second tab after the first has paid gets already_subscribed, and no charge", async () => {
    expect((await submit()).outcome).toBe("paid");
    expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("already_subscribed");
    expect(payments.charges).toHaveLength(1);
  });

  it("AC11: a member's rows are their own: another member pays beside them", async () => {
    const grace = await repo.saveAccount({ email: "grace@example.com", firstName: "Grace", lastName: "Hopper", phone: "216-555-0101", language: "en" });
    await submit();
    const result = await signUp(deps(NOW), { memberId: grace.id, choices: picks(), sourceId: OTHER_SOURCE, consentText: CONSENT });
    expect(result.outcome).toBe("paid");
    expect(payments.charges).toHaveLength(2);
    expect(await repo.findActiveSubscription(grace.id, product.id)).not.toBeNull();
  });
});

// Each order below is forced, not raced: a spy holds this tab at one step while the other tab acts.
describe("AC11 — a second tab lands between this tab's steps", () => {
  const rows = (over: Partial<PendingSignupInput> = {}): PendingSignupInput => ({
    memberId: member.id,
    productId: product.id,
    choices: picks(),
    firstChargeCents: 5000,
    weeklyCents: 5000,
    pickupDate: "2027-01-03",
    consentText: CONSENT,
    consentAt: NOW,
    ...over,
  });

  /** The member has their Square customer, so this tab goes straight from its checks to its save. */
  const linked = async (): Promise<string> => {
    const { id } = payments.addCustomer({ email: EMAIL, createdAt: NOW, updatedAt: NOW });
    await repo.setMemberSquareCustomer(member.id, id);
    return id;
  };

  /** `other` runs after this tab's last check and before its save lands. */
  const overtakenBeforeSave = (other: () => Promise<unknown>) => {
    const read = repo.findPendingSignup;
    vi.spyOn(repo, "findPendingSignup").mockImplementationOnce(async function (this: Repository, memberId, productId) {
      const found = await read.call(this, memberId, productId);
      await other();
      return found;
    });
  };

  /** The last charge_outcome_unknown recorded, its detail apart so a test can read its values. */
  const lastUnknown = () => {
    const event = repo.events().filter(({ kind }) => kind === "charge_outcome_unknown").at(-1);
    return { event, detail: (event as { detail?: object } | undefined)?.detail ?? {} };
  };

  it("AC11: a tab whose save lands after the first confirms gets already_subscribed, with no second row or charge", async () => {
    await linked();
    overtakenBeforeSave(() => submit({ sourceId: OTHER_SOURCE }));
    expect((await submit({ choices: picks(1, 0) })).outcome).toBe("already_subscribed");
    expect(payments.charges).toHaveLength(1);
    expect(await pending()).toBeNull();
    expect(kinds()).toEqual(["already_subscribed"]);
  });

  it("AC11: a tab whose save meets a card already bound rewrites nothing and takes the Try again path", async () => {
    const customerId = await linked();
    const row = await repo.savePendingSignup(rows());
    const card = await payments.saveCard({ customerId, sourceId: OTHER_SOURCE, idempotencyKey: sha256Key(OTHER_SOURCE) });
    overtakenBeforeSave(() => repo.saveSubscriptionCard(row.subscriptionId, card.id));
    const save = vi.spyOn(payments, "saveCard");
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    expect(await submit({ choices: picks(1, 1) })).toMatchObject({ outcome: "paid", subscriptionId: row.subscriptionId });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(payments.charges).toMatchObject([{ amountCents: 5000, cardId: card.id }]);
  });

  it("AC11: signUp charges the amount the bind returned, not the one its own save read", async () => {
    overtakenBeforeBind(() => repo.savePendingSignup(rows({ choices: picks(1, 0), firstChargeCents: 8000, weeklyCents: 8000 })));
    expect((await submit()).outcome).toBe("paid");
    expect(payments.charges.map((charge) => charge.amountCents)).toEqual([8000]);
  });

  it("AC11: signUp keys the charge on the attempt the bind returned, not the one its own save read", async () => {
    let ledgerId: string | undefined;
    overtakenBeforeBind(async () => {
      ledgerId = (await pending())?.ledgerId;
      await repo.recordSignupDecline(ledgerId ?? "no row");
      await repo.savePendingSignup(rows());
    });
    await submit();
    expect(payments.charges.map((charge) => charge.idempotencyKey)).toEqual([`${ledgerId}:2`]);
  });

  it("AC11: a lost bind looks first, then charges the card that won, never its own", async () => {
    let won: string | undefined;
    overtakenBeforeBind(async ({ customerId }) => {
      won = (await otherTabBinds(customerId)).cardId;
    });
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    expect((await submit()).outcome).toBe("paid");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(payments.charges.map((charge) => charge.cardId)).toEqual([won]);
  });

  it("AC11: a lost bind to a tab that has charged confirms that payment, with no second charge", async () => {
    overtakenBeforeBind(async ({ customerId }) => {
      const { cardId, ledgerId } = await otherTabBinds(customerId);
      await payments.charge({ customerId, cardId, amountCents: 5000, idempotencyKey: `${ledgerId}:1`, referenceId: ledgerId });
    });
    expect((await submit()).outcome).toBe("paid");
    expect(payments.charges).toHaveLength(1);
    expect(await active()).not.toBeNull();
  });

  it("AC11: a lost bind to a tab that has confirmed gets already_subscribed, and nothing reads as unknown", async () => {
    overtakenBeforeBind(() => submit({ sourceId: OTHER_SOURCE }));
    expect((await submit()).outcome).toBe("already_subscribed");
    expect(payments.charges).toHaveLength(1);
    expect(kinds()).toEqual(["already_subscribed"]);
  });

  it("AC11: a charge that is not the ledger's amount confirms nothing: the row stays pending, and the event holds both amounts", async () => {
    const bind = repo.saveSubscriptionCard;
    vi.spyOn(repo, "saveSubscriptionCard").mockImplementationOnce(async function (this: Repository, subscriptionId, cardId) {
      const bound = await bind.call(this, subscriptionId, cardId);
      return typeof bound === "object" && bound !== null ? { ...bound, amountCents: 7000 } : bound;
    });
    expect((await submit()).outcome).toBe("unknown");
    expect(payments.charges.map((charge) => charge.amountCents)).toEqual([7000]);
    const row = await pending();
    expect(row).toMatchObject({ ledgerStatus: "pending", amountCents: 5000 });
    expect(await active()).toBeNull();
    const { event, detail } = lastUnknown();
    expect(event).toMatchObject({ memberId: member.id, detail: { ledgerId: row?.ledgerId }, actor: asMember() });
    expect(Object.values(detail)).toEqual(expect.arrayContaining([5000, 7000]));
  });

  it("AC11: a payment found for another amount confirms nothing, on this Try again or the next, and nothing more is charged", async () => {
    chargeGetsNoAnswer(2);
    await submit();
    const row = await pending();
    const ledgerId = row?.ledgerId ?? "no row";
    await payments.charge({
      customerId: (await stored())?.squareCustomerId ?? "no customer",
      cardId: row?.squareCardId ?? "no card",
      amountCents: 8000,
      idempotencyKey: "an earlier run",
      referenceId: ledgerId,
    });

    expect((await retry()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", amountCents: 5000 });
    expect(await active()).toBeNull();
    const { event, detail } = lastUnknown();
    expect(event).toMatchObject({ memberId: member.id, detail: { ledgerId }, actor: asMember() });
    expect(Object.values(detail)).toEqual(expect.arrayContaining([5000, 8000]));

    expect((await retry()).outcome).toBe("unknown");
    expect(payments.charges).toHaveLength(1);
  });
});

describe("issue 57 — the cap", () => {
  let others = 0;

  /** A new repository holding the Supper Club at `cap`, and the member, with nothing held. */
  const cappedAt = async (cap: number): Promise<void> => {
    const stocked = { ...product, cap };
    repo = new InMemoryRepository();
    product = repo.addProduct(stocked);
    member = await repo.saveAccount({ email: EMAIL, firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
    await repo.confirmMemberEmail(member.id, NOW);
  };

  const another = () => repo.saveAccount({ email: `other-${++others}@example.com`, firstName: "Grace", lastName: "Hopper", phone: "216-555-0101", language: "en" });

  const rowsFor = (memberId: string): PendingSignupInput => ({
    memberId,
    productId: product.id,
    choices: picks(),
    firstChargeCents: 5000,
    weeklyCents: 5000,
    pickupDate: "2027-01-03",
    consentText: CONSENT,
    consentAt: NOW,
  });

  /** Another member with a card on a pending row and the charge unanswered. */
  const holdsASpot = async (): Promise<void> => {
    const row = await repo.savePendingSignup(rowsFor((await another()).id));
    await repo.saveSubscriptionCard(row.subscriptionId, `ccof:${row.subscriptionId}`);
  };

  /** Another member with an active subscription, confirmed straight on, as a lowered cap would leave them. */
  const hasAnActiveSubscription = async (): Promise<void> => {
    const row = await repo.savePendingSignup(rowsFor((await another()).id));
    await repo.confirmSignupRows(row.ledgerId, `PAYMENT_${row.ledgerId}`, row.amountCents, NOW);
  };

  /** Another member's whole signup, through the front door. */
  const anotherSignsUp = async (now = NOW) => signUp(deps(now), { memberId: (await another()).id, choices: picks(), sourceId: `cnon:other-${++others}`, consentText: CONSENT });

  const held = () => repo.countHeldSpots(product.id);

  describe("AC2 — a held spot does not expire", () => {
    it("AC2 (issue 57): ten years on, a spot held by an unanswered charge still fills the cap, and its holder's Try again still pays", async () => {
      await cappedAt(1);
      chargeGetsNoAnswer(2);
      expect((await submit()).outcome).toBe("unknown");
      const decade = new Date("2036-11-06T15:00:00.000Z");
      expect((await anotherSignsUp(decade)).outcome).toBe("sold_out");
      expect((await retry(decade)).outcome).toBe("paid");
    });
  });

  describe("AC6 — at the cap, signUp refuses before Square", () => {
    it.each<[string, () => Promise<void>]>([
      ["an active subscription", hasAnActiveSubscription],
      ["a held spot", holdsASpot],
    ])("AC6 (issue 57): the cap reached by %s: sold_out, with no customer, no card, no charge and no rows", async (_what, fill) => {
      await cappedAt(1);
      await fill();
      const search = vi.spyOn(payments, "findCustomersByEmail");
      const create = vi.spyOn(payments, "createCustomer");
      const card = vi.spyOn(payments, "saveCard");
      const save = vi.spyOn(repo, "savePendingSignup");
      expect(await submit()).toMatchObject({ outcome: "sold_out" });
      expect(search).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(card).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(payments.customers).toEqual([]);
      expect(payments.charges).toEqual([]);
      expect(await pending()).toBeNull();
      expect((await stored())?.squareCustomerId).toBeNull();
    });

    it("AC6 (issue 57): a member's own cardless pending row holds nothing: at the cap they are refused and the row is left as it was", async () => {
      await cappedAt(1);
      const row = await repo.savePendingSignup(rowsFor(member.id));
      await holdsASpot();
      expect((await submit({ choices: picks(1, 1) })).outcome).toBe("sold_out");
      expect(await pending()).toMatchObject({ subscriptionId: row.subscriptionId, ledgerStatus: "pending", attempt: 1, squareCardId: null, amountCents: 5000 });
      expect(payments.charges).toEqual([]);
    });

    it("AC6 (issue 57): one spot short of the cap, signUp goes on and pays, which guards the refusals above", async () => {
      await cappedAt(2);
      await holdsASpot();
      expect((await submit()).outcome).toBe("paid");
      expect(payments.charges).toHaveLength(1);
    });

    it("AC6 (issue 57): the last spot taken, the next member is refused", async () => {
      await cappedAt(1);
      expect((await submit()).outcome).toBe("paid");
      expect((await anotherSignsUp()).outcome).toBe("sold_out");
      expect(payments.charges).toHaveLength(1);
    });

    it("AC6 (issue 57): a member with an active subscription, at the cap, is already_subscribed, and no sold_out is recorded", async () => {
      await cappedAt(1);
      await alreadyActive();
      expect((await submit()).outcome).toBe("already_subscribed");
      expect(kinds()).toEqual(["already_subscribed"]);
    });
  });

  describe("AC7 — the last spot goes after the check", () => {
    it("AC7 (issue 57): the bind refuses, signUp returns sold_out, nothing is charged and the pending row stays cardless", async () => {
      await cappedAt(1);
      overtakenBeforeBind(holdsASpot);
      const charge = vi.spyOn(payments, "charge");
      const lookup = vi.spyOn(payments, "findPaymentByReference");
      expect(await submit()).toMatchObject({ outcome: "sold_out" });
      expect(charge).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, squareCardId: null });
      expect(await active()).toBeNull();
    });

    it("AC7 (issue 57): a bind lost to the member's own other tab at the cap takes that tab's card, not sold_out", async () => {
      await cappedAt(1);
      let won: string | undefined;
      overtakenBeforeBind(async ({ customerId }) => {
        won = (await otherTabBinds(customerId)).cardId;
      });
      expect((await submit()).outcome).toBe("paid");
      expect(payments.charges.map((charge) => charge.cardId)).toEqual([won]);
      expect(kinds()).not.toContain("sold_out");
    });

    it("AC7 (issue 57): a bind lost to the member's own other tab that confirmed, at the cap, is already_subscribed, not sold_out", async () => {
      await cappedAt(1);
      overtakenBeforeBind(() => submit({ sourceId: OTHER_SOURCE }));
      expect((await submit()).outcome).toBe("already_subscribed");
      expect(payments.charges).toHaveLength(1);
      expect(kinds()).toEqual(["already_subscribed"]);
    });

    it("AC7 (issue 57): a refused card in another tab leaves the row declined and cardless: this tab's bind is refused, it returns error and charges nothing", async () => {
      overtakenBeforeBind(async () => repo.recordSignupDecline((await pending())?.ledgerId ?? "no row"));
      expect((await submit()).outcome).toBe("error");
      expect(payments.charges).toEqual([]);
      expect(await pending()).toMatchObject({ ledgerStatus: "declined", squareCardId: null });
    });

    it("AC7 (issue 57): the same at the cap is error too, with no sold_out recorded", async () => {
      await cappedAt(1);
      overtakenBeforeBind(async () => {
        await repo.recordSignupDecline((await pending())?.ledgerId ?? "no row");
        await holdsASpot();
      });
      expect((await submit()).outcome).toBe("error");
      expect(payments.charges).toEqual([]);
      expect(kinds()).not.toContain("sold_out");
    });
  });

  describe("AC10 — every refusal is recorded", () => {
    it("AC10 (issue 57): a refusal at the check records one sold_out event, with no detail, under the member", async () => {
      await cappedAt(1);
      await holdsASpot();
      await submit();
      expect(repo.events()).toEqual([{ kind: "sold_out", memberId: member.id, actor: asMember() }]);
    });

    it("AC10 (issue 57): a refusal at the bind records one sold_out event, with no detail, under the member", async () => {
      await cappedAt(1);
      overtakenBeforeBind(holdsASpot);
      await submit();
      expect(repo.events()).toEqual([{ kind: "sold_out", memberId: member.id, actor: asMember() }]);
    });
  });

  describe("AC11 — a decline releases the spot", () => {
    it("AC11 (issue 57): a decline at the charge frees the spot it held, and another member then takes it", async () => {
      await cappedAt(1);
      nextCardDeclines();
      const real = payments.charge.bind(payments);
      const during: number[] = [];
      vi.spyOn(payments, "charge").mockImplementationOnce(async (input) => {
        during.push(await held());
        return real(input);
      });
      expect((await submit()).outcome).toBe("declined");
      expect(during).toEqual([1]);
      expect(await held()).toBe(0);
      expect((await anotherSignsUp()).outcome).toBe("paid");
      expect(await held()).toBe(1);
    });

    it("AC11 (issue 57): a card refused at the save holds nothing either, and another member then takes the spot", async () => {
      await cappedAt(1);
      vi.spyOn(payments, "saveCard").mockRejectedValueOnce(refused());
      expect((await submit()).outcome).toBe("declined");
      expect(await held()).toBe(0);
      expect((await anotherSignsUp()).outcome).toBe("paid");
    });
  });

  describe("AC12 — a declined member resubmits at the cap", () => {
    it("AC12 (issue 57): they get sold_out, with no second charge attempt, and the row stays as the decline left it", async () => {
      await cappedAt(1);
      nextCardDeclines();
      expect((await submit()).outcome).toBe("declined");
      expect((await anotherSignsUp()).outcome).toBe("paid");
      const card = vi.spyOn(payments, "saveCard");
      card.mockClear();
      expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("sold_out");
      expect(card).not.toHaveBeenCalled();
      expect(payments.charges.filter((charge) => charge.customerId === payments.customers[0]?.id)).toHaveLength(1);
      expect(await pending()).toMatchObject({ ledgerStatus: "declined", attempt: 1 });
    });
  });

  describe('AC13 — "Try again" never meets the cap', () => {
    it("AC13 (issue 57): the stranded spot is the member's own: at the cap it counts as held, and Try again pays", async () => {
      await cappedAt(1);
      chargeGetsNoAnswer(2);
      await submit();
      expect(await held()).toBe(1);
      expect((await retry()).outcome).toBe("paid");
      expect(await held()).toBe(1);
      expect(kinds()).not.toContain("sold_out");
    });

    it("AC13 (issue 57): a normal submit on a stranded row at the cap takes the Try again path, not sold_out", async () => {
      await cappedAt(1);
      chargeGetsNoAnswer(2);
      await submit();
      const card = vi.spyOn(payments, "saveCard");
      expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("paid");
      expect(card).not.toHaveBeenCalled();
      expect(kinds()).not.toContain("sold_out");
    });

    it("AC13 (issue 57): declined on Try again, the spot is released, and another member then takes it", async () => {
      await cappedAt(1);
      nextCardDeclines();
      chargeGetsNoAnswer(2);
      await submit();
      expect(await held()).toBe(1);
      expect((await retry()).outcome).toBe("declined");
      expect(await held()).toBe(0);
      expect((await anotherSignsUp()).outcome).toBe("paid");
    });
  });

  describe("AC14 — a charge Square took always confirms", () => {
    it("AC14 (issue 57): a payment Try again finds confirms though the count is past the cap", async () => {
      await cappedAt(1);
      chargeReplyIsLost(2);
      await submit();
      await hasAnActiveSubscription();
      expect(await held()).toBe(2);
      expect((await retry()).outcome).toBe("paid");
      expect(await active()).not.toBeNull();
      expect(payments.charges).toHaveLength(1);
    });

    it("AC14 (issue 57): a charge Try again sends confirms though the count is past the cap", async () => {
      await cappedAt(1);
      chargeGetsNoAnswer(2);
      await submit();
      await hasAnActiveSubscription();
      expect((await retry()).outcome).toBe("paid");
      expect(await held()).toBe(2);
    });
  });
});

describe("AC12 — Square's detail stays out of the logs", () => {
  const METHODS = ["log", "info", "warn", "error", "debug"] as const;
  const logged = (spies: Array<{ mock: { calls: unknown[][] } }>) => spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((arg) => inspect(arg, { depth: 8 })).join(" "))).join("\n");
  const silenced = () => METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

  it("AC12: a charge that throws logs none of its detail, and the event carries none", async () => {
    const spies = silenced();
    vi.spyOn(payments, "charge").mockRejectedValue(outage());
    expect((await submit()).outcome).toBe("unknown");
    expect(logged(spies)).not.toContain(SQUARE_TEXT);
    expect(JSON.stringify(repo.events())).not.toContain(SQUARE_TEXT);
  });

  it("AC12: a failed saveCard logs none of its detail", async () => {
    const spies = silenced();
    const save = vi.spyOn(payments, "saveCard").mockRejectedValueOnce(outage());
    await submit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(logged(spies)).not.toContain(SQUARE_TEXT);
  });

  it("AC12: a refused card logs none of its detail, and the event carries none", async () => {
    const spies = silenced();
    vi.spyOn(payments, "saveCard").mockRejectedValueOnce(refused());
    expect((await submit()).outcome).toBe("declined");
    expect(logged(spies)).not.toContain(SQUARE_TEXT);
    expect(JSON.stringify(repo.events())).not.toContain(SQUARE_TEXT);
  });
});

describe("AC1, AC2, AC3 (issue 58) — confirmedNow, the whole guard against a second email", () => {
  /** Another tab's confirm lands while this tab waits on Square's answer to `method`. */
  const otherTabConfirmsDuring = (method: "charge" | "findPaymentByReference") => {
    const confirmOthers = async (ledgerId: string, paymentId: string, amountCents: number) => {
      expect(await repo.confirmSignupRows(ledgerId, paymentId, amountCents, NOW)).toBe("confirmed");
    };
    if (method === "charge") {
      const real = payments.charge.bind(payments);
      vi.spyOn(payments, "charge").mockImplementationOnce(async (input) => {
        const result = await real(input);
        if (result.outcome === "paid") await confirmOthers(input.referenceId ?? "no reference", result.paymentId, input.amountCents);
        return result;
      });
    } else {
      const real = payments.findPaymentByReference.bind(payments);
      vi.spyOn(payments, "findPaymentByReference").mockImplementationOnce(async (input) => {
        const found = await real(input);
        if (found) await confirmOthers(input.referenceId, found.paymentId, found.amountCents);
        return found;
      });
    }
  };

  it("AC1: a signup paid on the first try, whose confirm flipped the rows, says confirmedNow", async () => {
    expect(await submit()).toMatchObject({ outcome: "paid", confirmedNow: true });
  });

  it("AC2: Try again that charges, and whose confirm flips the rows, says confirmedNow", async () => {
    chargeGetsNoAnswer(2);
    await submit();
    expect(await retry()).toMatchObject({ outcome: "paid", confirmedNow: true });
  });

  it("AC2: Try again that finds Square's payment, and whose confirm flips the rows, says confirmedNow", async () => {
    chargeReplyIsLost(2);
    await submit();
    expect(await retry()).toMatchObject({ outcome: "paid", confirmedNow: true });
    expect(payments.charges).toHaveLength(1);
  });

  it("AC3: a paid signup whose rows another tab confirmed first says confirmedNow false", async () => {
    otherTabConfirmsDuring("charge");
    expect(await submit()).toMatchObject({ outcome: "paid", confirmedNow: false });
  });

  it("AC3: Try again that finds the payment, with the rows confirmed by another tab first, says confirmedNow false", async () => {
    chargeReplyIsLost(2);
    await submit();
    otherTabConfirmsDuring("findPaymentByReference");
    expect(await retry()).toMatchObject({ outcome: "paid", confirmedNow: false });
  });
});

describe("AC14 — docs/SPEC.md §7.3", () => {
  const spec = readFileSync(new URL("../docs/SPEC.md", import.meta.url), "utf8");

  it("AC14: Square is no longer called the customer directory there", () => {
    expect(spec).not.toContain("Square is the processor and the customer directory");
  });

  it("AC14: it says Square holds cards and charges, and that a customer Haul creates carries email only", () => {
    const flat = spec.replace(/\s+/g, " ");
    expect(flat).toMatch(/Square holds cards and charges/);
    expect(flat).toMatch(/email only/);
  });
});
