// Issue 56: signUp over the two fakes, submitted once and again. A provider that gives no answer, a
// reply that gets lost after Square took the money and a write that fails are each made by a spy on one
// method, which falls through to the fake once it is spent. What only Postgres can show (the actor on a
// trigger row, callers racing on a unique index) is in src/adapters/postgres-product.test.ts.
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { FakePayments } from "./adapters/fake-payments.js";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { runCharges } from "./charge-run.js";
import { customerIdempotencyKey, sha256Key } from "./customer-match.js";
import type { Member } from "./members.js";
import { IDEMPOTENCY_KEY_MAX, IdempotencyKeyReusedError, PaymentsError } from "./ports/payments.js";
import { AUDIT_EVENT_KINDS, SignupRefusedError, type PendingSignupInput, type Repository } from "./ports/repository.js";
import type { ProductWithOptions } from "./products.js";
import { signUp } from "./signup.js";

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

/** The request's start, and a clock that reads it too unless a test hands one that moves. */
const deps = (now: Date, clock: () => Date = () => now) => ({ repo, payments, now, clock });

type Submit = { choices: Record<string, string>; sourceId: string; consentText: string; now: Date };

const submit = ({ now = NOW, ...over }: Partial<Submit> = {}) =>
  signUp(deps(now), { memberId: member.id, choices: picks(), sourceId: SOURCE, consentText: CONSENT, ...over });

/** The member submits again, with the new card a second card entry gives, twenty minutes on unless told. */
const again = (over: Partial<Submit> = {}) => submit({ now: LATER, sourceId: OTHER_SOURCE, ...over });

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

/** The token the next submit sends is one Square declines to charge; another card's token is not. */
function nextCardDeclines(code = "GENERIC_DECLINE") {
  payments.declineCard(SOURCE, code);
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

/** `other` runs once this tab's pending rows have committed, before it starts its charge (`startSignupCharge`). */
const overtakenBeforeBind = (other: () => Promise<unknown>) => {
  const save = repo.savePendingSignup;
  const withActor = repo.withActor.bind(repo);
  let saved = false;
  vi.spyOn(repo, "savePendingSignup").mockImplementationOnce(async function (this: Repository, input) {
    const row = await save.call(this, input);
    saved = true;
    return row;
  });
  vi.spyOn(repo, "withActor").mockImplementation(async (actor, fn) => {
    const result = await withActor(actor, fn);
    if (saved) {
      saved = false;
      await other();
    }
    return result;
  });
};

/** Another tab starts its own card's charge on the row, about to send it. */
const otherTabBinds = async () => {
  const row = await pending();
  await repo.startSignupCharge(row?.subscriptionId ?? "no row", NOW);
  return { ledgerId: row?.ledgerId ?? "no row" };
};

/** Every source a card was saved from, in order. */
const savedFrom = (spy: { mock: { calls: Array<[{ sourceId: string }]> } }) => spy.mock.calls.map(([input]) => input.sourceId);

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
  // The cutoff's edge, 23:59 against midnight, is src/pickup-week.test.ts's; this holds that `now` reaches it.
  it("AC3: at Monday's cutoff (24:00), Cleveland time, the row is for January 10", async () => {
    await submit({ now: new Date("2026-12-29T05:00:00.000Z") });
    expect((await repo.findSignupConfirmation(member.id, product.id))?.pickupDate).toBe("2027-01-10");
  });
});

// Issue 133: the closed and moved weeks' edges are src/pickup-week.test.ts's; these hold that signUp reads them.
describe("AC1, AC3 (issue 133) — the changed weeks", () => {
  it("AC1: with the first week closed, the ledger row is for the next open week's Sunday, January 10", async () => {
    await repo.savePickupWeek(product.id, {
      weekOf: "2027-01-03",
      closedAt: new Date("2026-11-01T12:00:00.000Z"),
      note: "Farm closed",
      firstDay: null,
      lastDay: null,
    });
    expect((await submit()).outcome).toBe("paid");
    expect((await repo.findSignupConfirmation(member.id, product.id))?.pickupDate).toBe("2027-01-10");
  });

  it("AC3: with the first week moved to Saturday and Sunday, the ledger row keeps the ordinary Sunday, January 3", async () => {
    await repo.savePickupWeek(product.id, { weekOf: "2027-01-03", closedAt: null, note: "Moved", firstDay: "2027-01-02", lastDay: "2027-01-03" });
    const save = vi.spyOn(repo, "savePendingSignup");
    expect((await submit()).outcome).toBe("paid");
    expect(save.mock.calls.map(([input]) => input.pickupDate)).toEqual(["2027-01-03"]);
    expect(await repo.findSignupConfirmation(member.id, product.id)).toMatchObject({
      pickupDate: "2027-01-03",
      firstDay: "2027-01-02",
      lastDay: "2027-01-03",
    });
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
  it("AC7: when the charge is sent, the pending rows are there, with the customer id and the moment the charge is sent on them", async () => {
    const real = payments.charge.bind(payments);
    const seen: Array<{ input: Parameters<FakePayments["charge"]>[0]; row: Awaited<ReturnType<typeof pending>>; customerId: string | null | undefined }> = [];
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      seen.push({ input, row: await pending(), customerId: (await stored())?.squareCustomerId });
      return real(input);
    });
    await submit();
    const [at] = seen;
    expect(at?.row).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSentAt: NOW });
    expect(at?.input.sourceId).toBe(SOURCE);
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
    expect(seen.map(({ method }) => method)).toEqual(["findCustomersByEmail", "setCustomerReference", "charge", "saveCard"]);
    expect(seen.filter((call) => call.open !== 0)).toEqual([]);
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
    const [card] = payments.cards;
    expect(card).toBeDefined();
    expect(confirm.mock.calls).toEqual([[ledgerId, charge?.result.paymentId, charge?.amountCents, NOW, card]]);
  });

  it("AC8: it records no event", async () => {
    expect((await submit()).outcome).toBe("paid");
    expect(repo.events()).toEqual([]);
  });
});

describe("AC1, AC2 (issue 102) — paid_at is when the paid answer came back", () => {
  /** A clock that reads `before` until `turn` is called and `after` from then on, however often it is read. */
  const turningClock = (before: Date, after: Date) => {
    let turned = false;
    return {
      clock: () => (turned ? after : before),
      turn: () => {
        turned = true;
      },
    };
  };

  it("AC1: a charge that comes back paid confirms the rows at the clock's reading once it is back, and consent_at stays the request's start", async () => {
    const charging = new Date("2026-11-06T15:00:01.000Z");
    const answered = new Date("2026-11-06T15:00:03.000Z");
    const { clock, turn } = turningClock(charging, answered);
    const real = payments.charge.bind(payments);
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      const result = await real(input);
      turn();
      return result;
    });
    const save = vi.spyOn(repo, "savePendingSignup");
    const confirm = vi.spyOn(repo, "confirmSignupRows");

    const result = await signUp(deps(NOW, clock), { memberId: member.id, choices: picks(), sourceId: SOURCE, consentText: CONSENT });

    expect(result.outcome).toBe("paid");
    expect(confirm.mock.calls.map((call) => call[3])).toEqual([answered]);
    expect(save.mock.calls.map(([input]) => input.consentAt)).toEqual([NOW]);
  });

  it("AC2: a second submit that finds the payment Square took confirms the rows at the clock's reading once the lookup is back, not the submit's start", async () => {
    const charge = chargeReplyIsLost(2);
    await submit();
    charge.mockClear();
    const looking = new Date("2026-11-06T15:20:01.000Z");
    const found = new Date("2026-11-06T15:20:04.000Z");
    const { clock, turn } = turningClock(looking, found);
    const real = payments.findPaymentByReference.bind(payments);
    vi.spyOn(payments, "findPaymentByReference").mockImplementation(async (input) => {
      const payment = await real(input);
      turn();
      return payment;
    });
    const confirm = vi.spyOn(repo, "confirmSignupRows");

    expect((await signUp(deps(LATER, clock), { memberId: member.id, choices: picks(), sourceId: OTHER_SOURCE, consentText: CONSENT })).outcome).toBe("paid");

    expect(charge).not.toHaveBeenCalled();
    expect(confirm.mock.calls.map((call) => call[3])).toEqual([found]);
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

  it("AC10: with no answer twice, signUp returns unknown after exactly two tries, and the row stays pending with its charge out", async () => {
    const charge = chargeGetsNoAnswer(2);
    expect((await submit()).outcome).toBe("unknown");
    expect(charge).toHaveBeenCalledTimes(2);
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSentAt: NOW });
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

  it("AC2 (issue 254): a PaymentsError that leaves the outcome unknown is recorded by its code, with the ledger row", async () => {
    vi.spyOn(payments, "charge").mockRejectedValue(outage());
    await submit();
    const ledgerId = (await pending())?.ledgerId;
    expect(repo.events()).toEqual([{ kind: "charge_outcome_unknown", memberId: member.id, detail: { ledgerId, code: "SERVICE_UNAVAILABLE" }, actor: asMember() }]);
  });

  it("AC10: an IdempotencyKeyReusedError reads as unknown", async () => {
    const reused = new IdempotencyKeyReusedError({ status: 400, category: "INVALID_REQUEST_ERROR", code: "IDEMPOTENCY_KEY_REUSED", detail: "" });
    vi.spyOn(payments, "charge").mockRejectedValue(reused);
    expect((await submit()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending" });
  });
});

describe("AC10 — submitting again while the charge is out", () => {
  it("AC10: it asks Square first, with the ledger row and the subscription's created_at", async () => {
    chargeGetsNoAnswer(2);
    await submit();
    const row = await pending();
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    await again();
    expect(row?.ledgerId).toBeDefined();
    expect(lookup.mock.calls).toEqual([[{ referenceId: row?.ledgerId, since: row?.createdAt }]]);
  });

  it("AC10: a payment found confirms the signup with no charge", async () => {
    const charge = chargeReplyIsLost(2);
    await submit();
    const row = await pending();
    charge.mockClear();
    const confirm = vi.spyOn(repo, "confirmSignupRows");
    const result = await again();
    expect(result).toMatchObject({ outcome: "paid", subscriptionId: row?.subscriptionId });
    expect(charge).not.toHaveBeenCalled();
    expect(payments.charges).toHaveLength(1);
    const [card] = payments.cards;
    expect(card).toBeDefined();
    expect(confirm.mock.calls).toEqual([[row?.ledgerId, payments.charges[0]?.result.paymentId, payments.charges[0]?.amountCents, LATER, card]]);
    expect(await active()).toEqual({ id: row?.subscriptionId });
  });

  it("AC10: with none found it charges the new card, for the amount on the row, under the same key, never a new one, and pays", async () => {
    const charge = chargeGetsNoAnswer(2);
    await submit({ choices: picks(1, 0) });
    const row = await pending();
    const key = charge.mock.calls[0]?.[0].idempotencyKey;
    expect((await again()).outcome).toBe("paid");
    expect(payments.charges).toHaveLength(1);
    expect(payments.charges[0]).toMatchObject({ idempotencyKey: key, sourceId: OTHER_SOURCE, amountCents: 8000, referenceId: row?.ledgerId });
    expect(await active()).toEqual({ id: row?.subscriptionId });
  });

  it("AC10: it looks before it charges", async () => {
    const charge = chargeGetsNoAnswer(2);
    await submit();
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    await again();
    expect(lookup.mock.invocationCallOrder[0]).toBeLessThan(charge.mock.invocationCallOrder.at(-1) ?? 0);
    expect(charge).toHaveBeenCalledTimes(3);
  });

  it("AC10: a decline there is a decline: no charge is left owing, and the next submit is attempt 2", async () => {
    payments.declineCard(OTHER_SOURCE, "GENERIC_DECLINE");
    chargeGetsNoAnswer(2);
    await submit();
    expect((await again()).outcome).toBe("declined");
    const row = await pending();
    expect(row).toMatchObject({ ledgerStatus: "declined" });
    expect(kinds()).toContain("card_declined");
    expect((await submit({ sourceId: "cnon:third-card" })).outcome).toBe("paid");
    expect(payments.charges.at(-1)?.idempotencyKey).toBe(`${row?.ledgerId}:2`);
  });

  it("AC10: if the lookup throws, the outcome is unknown and no charge is attempted", async () => {
    const charge = chargeGetsNoAnswer(2);
    await submit();
    charge.mockClear();
    vi.spyOn(payments, "findPaymentByReference").mockRejectedValueOnce(noAnswer());
    expect((await again()).outcome).toBe("unknown");
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
    expect((await again()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", chargeSentAt: LATER });
    expect(await active()).toBeNull();
    answering = true;
    expect((await again()).outcome).toBe("paid");
    expect(payments.charges).toHaveLength(1);
  });
});

describe("AC10 — a normal submit on a row in the retry state", () => {
  it("AC10, AC7 (issue 254): it rewrites nothing, ignores the picks, and charges the new card under the same key for the row's amount and picks", async () => {
    chargeGetsNoAnswer(2);
    await submit();
    const row = await pending();
    const save = vi.spyOn(repo, "savePendingSignup");
    const result = await submit({ choices: picks(1, 1), sourceId: OTHER_SOURCE, consentText: "Other wording." });
    expect(result.outcome).toBe("paid");
    expect(save).not.toHaveBeenCalled();
    expect(payments.charges).toHaveLength(1);
    expect(payments.charges[0]).toMatchObject({ amountCents: 5000, sourceId: OTHER_SOURCE, idempotencyKey: `${row?.ledgerId}:1` });
    expect(await repo.findSignupConfirmation(member.id, product.id)).toMatchObject({ firstChargeCents: 5000, choices: picks() });
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
    ["starting the charge", () => vi.spyOn(repo, "startSignupCharge").mockRejectedValueOnce(new Error("write failed"))],
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

  it("AC10a: an error before the charge is started leaves no charge out", async () => {
    vi.spyOn(repo, "startSignupCharge").mockRejectedValueOnce(new Error("write failed"));
    await submit();
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", chargeSentAt: null });
  });

  it("AC10a: after a decline, a failure starting the charge leaves none out either", async () => {
    nextCardDeclines();
    await submit();
    vi.spyOn(repo, "startSignupCharge").mockRejectedValueOnce(new Error("write failed"));
    expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("error");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 2, chargeSentAt: null });
  });
});

describe("AC10a — a write that fails after the charge", () => {
  it("AC10a: after a paid charge it is unknown, the row stays pending, and a second submit finishes with no second charge", async () => {
    vi.spyOn(repo, "confirmSignupRows").mockRejectedValueOnce(new Error("write failed"));
    expect((await submit()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", chargeSentAt: NOW });
    expect(payments.charges).toHaveLength(1);
    expect((await again()).outcome).toBe("paid");
    expect(payments.charges).toHaveLength(1);
    expect(await active()).not.toBeNull();
  });

  it("AC10a: after a decline it is unknown, and a submit ten minutes on finds that key used and pays under the next", async () => {
    nextCardDeclines("INSUFFICIENT_FUNDS");
    vi.spyOn(repo, "recordSignupDecline").mockRejectedValueOnce(new Error("write failed"));
    expect((await submit()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending" });
    const ledgerId = (await pending())?.ledgerId;
    expect((await again()).outcome).toBe("paid");
    expect(payments.charges.map((charge) => [charge.idempotencyKey, charge.result.outcome])).toEqual([
      [`${ledgerId}:1`, "declined"],
      [`${ledgerId}:2`, "paid"],
    ]);
    expect(await active()).not.toBeNull();
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

  it("AC11: a tab whose save meets a charge already out rewrites nothing, looks first, and charges its own card under that charge's key", async () => {
    await linked();
    const row = await repo.savePendingSignup(rows());
    overtakenBeforeSave(() => repo.startSignupCharge(row.subscriptionId, NOW));
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    expect(await submit({ choices: picks(1, 1) })).toMatchObject({ outcome: "paid", subscriptionId: row.subscriptionId });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(payments.charges).toMatchObject([{ amountCents: 5000, sourceId: SOURCE, idempotencyKey: `${row.ledgerId}:1` }]);
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

  it("AC11: a lost bind looks first, then charges its own card under the key of the charge that won", async () => {
    overtakenBeforeBind(otherTabBinds);
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    expect((await submit()).outcome).toBe("paid");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(payments.charges.map((charge) => [charge.sourceId, charge.idempotencyKey])).toEqual([[SOURCE, `${payments.charges[0]?.referenceId}:1`]]);
  });

  it("AC11: a lost bind to a tab that has charged confirms that payment, with no second charge", async () => {
    overtakenBeforeBind(async () => {
      const { ledgerId } = await otherTabBinds();
      const customerId = (await stored())?.squareCustomerId ?? "no customer";
      await payments.charge({ customerId, sourceId: OTHER_SOURCE, amountCents: 5000, idempotencyKey: `${ledgerId}:1`, referenceId: ledgerId, customerInitiated: true });
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
    const bind = repo.startSignupCharge;
    vi.spyOn(repo, "startSignupCharge").mockImplementationOnce(async function (this: Repository, subscriptionId, now) {
      const bound = await bind.call(this, subscriptionId, now);
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

  it("AC11: a payment found for another amount confirms nothing, on this submit or the next, and nothing more is charged", async () => {
    chargeGetsNoAnswer(2);
    await submit();
    const row = await pending();
    const ledgerId = row?.ledgerId ?? "no row";
    await payments.charge({
      customerId: (await stored())?.squareCustomerId ?? "no customer",
      sourceId: SOURCE,
      amountCents: 8000,
      idempotencyKey: "an earlier run",
      referenceId: ledgerId,
      customerInitiated: true,
    });

    expect((await again()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", amountCents: 5000 });
    expect(await active()).toBeNull();
    const { event, detail } = lastUnknown();
    expect(event).toMatchObject({ memberId: member.id, detail: { ledgerId }, actor: asMember() });
    expect(Object.values(detail)).toEqual(expect.arrayContaining([5000, 8000]));

    expect((await again()).outcome).toBe("unknown");
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

  /** Another member with a pending row whose charge is out, unanswered. */
  const holdsASpot = async (): Promise<void> => {
    const row = await repo.savePendingSignup(rowsFor((await another()).id));
    await repo.startSignupCharge(row.subscriptionId, NOW);
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
    it("AC2 (issue 57): ten years on, a spot held by an unanswered charge still fills the cap, and its holder's next submit still pays", async () => {
      await cappedAt(1);
      chargeGetsNoAnswer(2);
      expect((await submit()).outcome).toBe("unknown");
      const decade = new Date("2036-11-06T15:00:00.000Z");
      expect((await anotherSignsUp(decade)).outcome).toBe("sold_out");
      expect((await again({ now: decade })).outcome).toBe("paid");
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

    it("AC6 (issue 57): a member's own pending row with no charge out holds nothing: at the cap they are refused and the row is left as it was", async () => {
      await cappedAt(1);
      const row = await repo.savePendingSignup(rowsFor(member.id));
      await holdsASpot();
      expect((await submit({ choices: picks(1, 1) })).outcome).toBe("sold_out");
      expect(await pending()).toMatchObject({ subscriptionId: row.subscriptionId, ledgerStatus: "pending", attempt: 1, chargeSentAt: null, amountCents: 5000 });
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
    it("AC7 (issue 57): the bind refuses, signUp returns sold_out, nothing is charged and the pending row has no charge out", async () => {
      await cappedAt(1);
      overtakenBeforeBind(holdsASpot);
      const charge = vi.spyOn(payments, "charge");
      const lookup = vi.spyOn(payments, "findPaymentByReference");
      expect(await submit()).toMatchObject({ outcome: "sold_out" });
      expect(charge).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSentAt: null });
      expect(await active()).toBeNull();
    });

    it("AC7 (issue 57): a bind lost to the member's own other tab at the cap charges its own card under that tab's key, not sold_out", async () => {
      await cappedAt(1);
      overtakenBeforeBind(otherTabBinds);
      expect((await submit()).outcome).toBe("paid");
      expect(payments.charges.map((charge) => [charge.sourceId, charge.idempotencyKey])).toEqual([[SOURCE, `${payments.charges[0]?.referenceId}:1`]]);
      expect(kinds()).not.toContain("sold_out");
    });

    it("AC7 (issue 57): a bind lost to the member's own other tab that confirmed, at the cap, is already_subscribed, not sold_out", async () => {
      await cappedAt(1);
      overtakenBeforeBind(() => submit({ sourceId: OTHER_SOURCE }));
      expect((await submit()).outcome).toBe("already_subscribed");
      expect(payments.charges).toHaveLength(1);
      expect(kinds()).toEqual(["already_subscribed"]);
    });

    it("AC7 (issue 57): a declined card in another tab leaves the row declined with no charge out: this tab's bind is refused, it returns error and charges nothing", async () => {
      overtakenBeforeBind(async () => repo.recordSignupDecline((await pending())?.ledgerId ?? "no row"));
      expect((await submit()).outcome).toBe("error");
      expect(payments.charges).toEqual([]);
      expect(await pending()).toMatchObject({ ledgerStatus: "declined", chargeSentAt: null });
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

  describe("AC13 — a submit over a charge that is out never meets the cap", () => {
    it("AC13 (issue 57): the stranded spot is the member's own: at the cap it counts as held, and a second submit pays", async () => {
      await cappedAt(1);
      chargeGetsNoAnswer(2);
      await submit();
      expect(await held()).toBe(1);
      expect((await again()).outcome).toBe("paid");
      expect(await held()).toBe(1);
      expect(kinds()).not.toContain("sold_out");
    });

    it("AC13 (issue 57): a normal submit on a stranded row at the cap charges the new card under the same key, not sold_out", async () => {
      await cappedAt(1);
      chargeGetsNoAnswer(2);
      await submit();
      expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("paid");
      expect(payments.charges.map((charge) => [charge.sourceId, charge.idempotencyKey])).toEqual([[OTHER_SOURCE, `${payments.charges[0]?.referenceId}:1`]]);
      expect(kinds()).not.toContain("sold_out");
    });

    it("AC13 (issue 57): declined on the second submit, the spot is released, and another member then takes it", async () => {
      await cappedAt(1);
      payments.declineCard(OTHER_SOURCE, "GENERIC_DECLINE");
      chargeGetsNoAnswer(2);
      await submit();
      expect(await held()).toBe(1);
      expect((await again()).outcome).toBe("declined");
      expect(await held()).toBe(0);
      expect((await anotherSignsUp()).outcome).toBe("paid");
    });
  });

  describe("AC14 — a charge Square took always confirms", () => {
    it("AC14 (issue 57): a payment a second submit finds confirms though the count is past the cap", async () => {
      await cappedAt(1);
      chargeReplyIsLost(2);
      await submit();
      await hasAnActiveSubscription();
      expect(await held()).toBe(2);
      expect((await again()).outcome).toBe("paid");
      expect(await active()).not.toBeNull();
      expect(payments.charges).toHaveLength(1);
    });

    it("AC14 (issue 57): a charge a second submit sends confirms though the count is past the cap", async () => {
      await cappedAt(1);
      chargeGetsNoAnswer(2);
      await submit();
      await hasAnActiveSubscription();
      expect((await again()).outcome).toBe("paid");
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

  it("AC12: a saveCard that fails after the payment logs none of its detail", async () => {
    const spies = silenced();
    const save = vi.spyOn(payments, "saveCard").mockRejectedValueOnce(outage());
    expect((await submit()).outcome).toBe("paid");
    expect(save).toHaveBeenCalledTimes(1);
    expect(logged(spies)).not.toContain(SQUARE_TEXT);
  });

  it("AC12: a card Square refuses to save after the payment logs none of its detail, and the event carries none", async () => {
    const spies = silenced();
    vi.spyOn(payments, "saveCard").mockRejectedValueOnce(refused());
    expect((await submit()).outcome).toBe("paid");
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

  it("AC2: a second submit that charges, and whose confirm flips the rows, says confirmedNow", async () => {
    chargeGetsNoAnswer(2);
    await submit();
    expect(await again()).toMatchObject({ outcome: "paid", confirmedNow: true });
  });

  it("AC2: a second submit that finds Square's payment, and whose confirm flips the rows, says confirmedNow", async () => {
    chargeReplyIsLost(2);
    await submit();
    expect(await again()).toMatchObject({ outcome: "paid", confirmedNow: true });
    expect(payments.charges).toHaveLength(1);
  });

  it("AC3: a paid signup whose rows another tab confirmed first says confirmedNow false", async () => {
    otherTabConfirmsDuring("charge");
    expect(await submit()).toMatchObject({ outcome: "paid", confirmedNow: false });
  });

  it("AC3: a second submit that finds the payment, with the rows confirmed by another tab first, says confirmedNow false", async () => {
    chargeReplyIsLost(2);
    await submit();
    otherTabConfirmsDuring("findPaymentByReference");
    expect(await again()).toMatchObject({ outcome: "paid", confirmedNow: false });
  });
});

// Issue 254: the charge goes to the card token, then the card is saved from the payment. What settling a paid charge
// saves, confirms and records in each case is settlePaid's (src/ledger-charge.test.ts), when a dead token is thrown or resent
// is sendCharge's, and what a submit over a charge that is out sends is takeCharge's; startSignupCharge, abandonCharge and
// which rows hold a spot are the repository's (src/adapters/signup-contract.ts, src/adapters/charge-run-contract.ts). Here
// each goes through signUp, submitted once and again.
describe("issue 254 — charge the token, then save the card", () => {
  const held = () => repo.countHeldSpots(product.id);
  const dead = (code = "CARD_TOKEN_EXPIRED"): PaymentsError => new PaymentsError({ status: 400, category: "INVALID_REQUEST_ERROR", code, detail: SQUARE_TEXT });
  const onFile = async () => repo.findSubscriptionCard((await active())?.id ?? "no subscription");
  const notSaved = () => repo.events().filter((event) => event.kind === "card_not_saved");

  /** A signup whose charge and its resend got no answer: pending with its charge out. The charge that went out. */
  const leftOut = async () => {
    const charge = chargeGetsNoAnswer(2);
    expect((await submit()).outcome).toBe("unknown");
    const sent = charge.mock.calls[0]?.[0];
    vi.restoreAllMocks();
    return { sent, row: await pending() };
  };

  it("AC1 (issue 254): Pay charges the card token, buyer-started, under ledgerId:attempt with the ledger id as its reference, before any card is saved", async () => {
    const real = payments.charge.bind(payments);
    const atCharge: Array<{ ledgerId: string | undefined; cards: number }> = [];
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      atCharge.push({ ledgerId: (await pending())?.ledgerId, cards: payments.cards.length });
      return real(input);
    });
    await submit();
    const [seen] = atCharge;
    expect(atCharge).toEqual([{ ledgerId: expect.any(String), cards: 0 }]);
    expect(payments.charges).toEqual([
      {
        customerId: payments.customers[0]?.id,
        sourceId: SOURCE,
        amountCents: 5000,
        idempotencyKey: `${seen?.ledgerId}:1`,
        referenceId: seen?.ledgerId,
        customerInitiated: true,
        result: { outcome: "paid", paymentId: expect.any(String) },
      },
    ]);
  });

  it("AC1 (issue 254): a blank sourceId is error: nothing is charged or saved, and no charge is out", async () => {
    const charge = vi.spyOn(payments, "charge");
    expect((await submit({ sourceId: "" })).outcome).toBe("error");
    expect(charge).not.toHaveBeenCalled();
    expect(payments.cards).toEqual([]);
    expect((await pending())?.chargeSentAt ?? null).toBeNull();
    expect(await held()).toBe(0);
  });

  // Square's CreatePayment takes these two words as money received outside Square, so a browser's text must never be one.
  it.each(["CASH", "EXTERNAL"])("AC1 (issue 254): a sourceId of %s is error, as a blank one is: nothing is sent to Square, and no charge is out", async (word) => {
    const charge = vi.spyOn(payments, "charge");
    const save = vi.spyOn(payments, "saveCard");
    const result = await submit({ sourceId: word });
    expect(charge).not.toHaveBeenCalled();
    expect(result.outcome).toBe("error");
    expect(save).not.toHaveBeenCalled();
    expect(payments.customers).toEqual([]);
    expect((await pending())?.chargeSentAt ?? null).toBeNull();
    expect(await held()).toBe(0);
  });

  it("AC2 (issue 254): while the charge is out the row holds the moment it was sent and its spot, and a second tab's save is refused", async () => {
    const real = payments.charge.bind(payments);
    const during: unknown[] = [];
    vi.spyOn(payments, "charge").mockImplementationOnce(async (input) => {
      const second = repo.savePendingSignup({
        memberId: member.id,
        productId: product.id,
        choices: picks(1, 1),
        firstChargeCents: 8500,
        weeklyCents: 8500,
        pickupDate: "2027-01-03",
        consentText: CONSENT,
        consentAt: NOW,
      });
      during.push((await pending())?.chargeSentAt, await held(), await second.then(() => "saved", (error: unknown) => (error instanceof SignupRefusedError ? "refused" : error)));
      return real(input);
    });
    await submit();
    expect(during).toEqual([NOW, 1, "refused"]);
  });

  it("AC2 (issue 254): the moment is the clock's as the charge goes out, not the request's start", async () => {
    chargeGetsNoAnswer(2);
    const sentAt = new Date(NOW.getTime() + 2000);
    await signUp(deps(NOW, () => sentAt), { memberId: member.id, choices: picks(), sourceId: SOURCE, consentText: CONSENT });
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", chargeSentAt: sentAt });
  });

  it("AC3 (issue 254): a paid charge's card is saved once, from the payment's id, under its SHA-256, with no verification token; paid with confirmedNow, and the card is on file", async () => {
    const save = vi.spyOn(payments, "saveCard");
    const result = await submit();
    expect(result).toMatchObject({ outcome: "paid", confirmedNow: true });
    const paid = payments.charges[0]?.result;
    const paymentId = paid?.outcome === "paid" ? paid.paymentId : "no payment";
    expect(save.mock.calls).toStrictEqual([[{ customerId: payments.customers[0]?.id, sourceId: paymentId, idempotencyKey: sha256Key(paymentId) }]]);
    expect(await onFile()).toEqual({ brand: "VISA", last4: "1111" });
    expect(await active()).toEqual({ id: result.subscriptionId });
  });

  it("AC4 (issue 254): a paid charge whose card Square refuses to save: paid with confirmedNow, active with no card on file, and card_not_saved under the member", async () => {
    vi.spyOn(payments, "saveCard").mockRejectedValueOnce(refused("CVV_FAILURE"));
    const result = await submit();
    expect(result).toMatchObject({ outcome: "paid", confirmedNow: true });
    expect(await active()).toEqual({ id: result.subscriptionId });
    expect(await onFile()).toBeNull();
    const [charge] = payments.charges;
    expect(repo.events()).toEqual([
      { kind: "card_not_saved", memberId: member.id, detail: { ledgerId: charge?.referenceId, paymentId: charge?.result.paymentId, code: "CVV_FAILURE" }, actor: asMember() },
    ]);
  });

  it("AC5 (issue 254): a declined charge saves no card, no charge is out, the spot is released, and the decline is recorded", async () => {
    nextCardDeclines("INSUFFICIENT_FUNDS");
    const save = vi.spyOn(payments, "saveCard");
    expect(await submit()).toMatchObject({ outcome: "declined" });
    expect(save).not.toHaveBeenCalled();
    const row = await pending();
    expect(row).toMatchObject({ ledgerStatus: "declined", attempt: 1, chargeSentAt: null });
    expect(await held()).toBe(0);
    expect(repo.events()).toEqual([{ kind: "card_declined", memberId: member.id, detail: { ledgerId: row?.ledgerId, code: "INSUFFICIENT_FUNDS" }, actor: asMember() }]);
  });

  it("AC5 (issue 254): a decline that comes back once a later attempt is out ends nothing: the row keeps the newer charge", async () => {
    nextCardDeclines();
    const real = payments.charge.bind(payments);
    vi.spyOn(payments, "charge").mockImplementationOnce(async (input) => {
      const answer = await real(input);
      const row = await pending();
      expect(await repo.restartCharge(row?.ledgerId ?? "no row", 1, NOW, LATER)).toEqual({ attempt: 2, sentAt: LATER });
      return answer;
    });
    await submit();
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 2, chargeSentAt: LATER });
  });

  it.each(["", "CASH", "EXTERNAL"])("AC6 (issue 254): a sourceId of '%s' over a charge that is out is error: Square is not asked, nothing is sent, the row as it was", async (word) => {
    await leftOut();
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    const charge = vi.spyOn(payments, "charge");
    expect((await again({ sourceId: word })).outcome).toBe("error");
    expect(lookup).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSentAt: NOW });
    expect(kinds()).toEqual(["charge_outcome_unknown"]);
  });

  it("AC6 (issue 254): a second submit that finds the payment saves the card from it and charges nothing more", async () => {
    chargeReplyIsLost(2);
    await submit();
    vi.restoreAllMocks();
    const charge = vi.spyOn(payments, "charge");
    const save = vi.spyOn(payments, "saveCard");
    expect(await again()).toMatchObject({ outcome: "paid", confirmedNow: true });
    expect(charge).not.toHaveBeenCalled();
    expect(savedFrom(save)).toEqual([payments.charges[0]?.result.paymentId]);
    expect(await onFile()).toEqual({ brand: "VISA", last4: "1111" });
  });

  it("AC6 (issue 254): a second submit that finds the payment and cannot save its card is paid, active with no card, and records card_not_saved", async () => {
    chargeReplyIsLost(2);
    await submit();
    vi.restoreAllMocks();
    vi.spyOn(payments, "saveCard").mockRejectedValueOnce(outage());
    expect(await again()).toMatchObject({ outcome: "paid", confirmedNow: true });
    expect(await onFile()).toBeNull();
    expect(notSaved()).toHaveLength(1);
  });

  it("AC7 (issue 254): a second submit that finds none sends the charge again on its own card and nothing else changed, and saves the card from the payment it makes", async () => {
    const { sent } = await leftOut();
    const charge = vi.spyOn(payments, "charge");
    const save = vi.spyOn(payments, "saveCard");
    expect(await again({ choices: picks(1, 1) })).toMatchObject({ outcome: "paid", confirmedNow: true });
    expect(sent).toMatchObject({ sourceId: SOURCE, customerInitiated: true });
    expect(charge.mock.calls).toEqual([[{ ...sent, sourceId: OTHER_SOURCE }]]);
    expect(savedFrom(save)).toEqual([payments.charges[0]?.result.paymentId]);
    expect(await onFile()).toEqual({ brand: "VISA", last4: "1111" });
  });

  it("AC7 (issue 254): a submit that finds its charge taken over by another since it read the row is unknown: nothing sent, the other's mark kept, and the outcome recorded", async () => {
    const { row } = await leftOut();
    const ledgerId = row?.ledgerId ?? "no row";
    const real = payments.findPaymentByReference.bind(payments);
    vi.spyOn(payments, "findPaymentByReference").mockImplementationOnce(async (input) => {
      const found = await real(input);
      expect(await repo.markChargeSent(ledgerId, 1, NOW, LATER)).toEqual(LATER);
      return found;
    });
    const charge = vi.spyOn(payments, "charge");
    expect((await again()).outcome).toBe("unknown");
    expect(charge).not.toHaveBeenCalled();
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSentAt: LATER });
    expect(repo.events().at(-1)).toEqual({ kind: "charge_outcome_unknown", memberId: member.id, detail: { ledgerId }, actor: asMember() });
  });

  it.each(["CARD_TOKEN_EXPIRED", "CARD_TOKEN_USED"])("AC21 (issue 254): a second submit whose charge answers %s: error after one send, the charge before it still out as it was, its spot held, no event of its own", async (code) => {
    const { row } = await leftOut();
    const charge = vi.spyOn(payments, "charge").mockRejectedValue(dead(code));
    expect((await again()).outcome).toBe("error");
    expect(charge).toHaveBeenCalledTimes(1);
    expect(await pending()).toMatchObject({ ledgerId: row?.ledgerId, ledgerStatus: "pending", attempt: 1, chargeSentAt: NOW });
    expect(await held()).toBe(1);
    expect(kinds()).toEqual(["charge_outcome_unknown"]);
  });

  it("AC21 (issue 254): the next Pay after a dead token over a charge that is out is sent under that charge's key with the new token, and pays", async () => {
    const { row } = await leftOut();
    vi.spyOn(payments, "charge").mockRejectedValueOnce(dead());
    await again();
    vi.restoreAllMocks();
    expect((await again({ sourceId: "cnon:third-card" })).outcome).toBe("paid");
    expect(payments.charges).toMatchObject([{ idempotencyKey: `${row?.ledgerId}:1`, sourceId: "cnon:third-card" }]);
  });

  it("AC21 (issue 254): a normal Pay over a row whose charge is out takes the same path: the new card is charged under the same key, and refused leaves the earlier charge out", async () => {
    const { row } = await leftOut();
    const charge = vi.spyOn(payments, "charge").mockRejectedValueOnce(dead());
    expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("error");
    expect(charge.mock.calls.map(([input]) => [input.sourceId, input.idempotencyKey])).toEqual([[OTHER_SOURCE, `${row?.ledgerId}:1`]]);
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSentAt: NOW });
  });

  it("AC21 (issue 254): a dead token whose row another tab settled first is unknown", async () => {
    vi.spyOn(payments, "charge").mockRejectedValueOnce(dead());
    const abandon = vi.spyOn(repo, "abandonCharge").mockResolvedValueOnce(null);
    expect((await submit()).outcome).toBe("unknown");
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(kinds()).toEqual(["charge_outcome_unknown"]);
  });

  it("AC21 (issue 254): a dead token on the first Pay is error after one send: no charge out, the next attempt, the spot released, and no event", async () => {
    const charge = vi.spyOn(payments, "charge").mockRejectedValue(dead());
    expect((await submit()).outcome).toBe("error");
    expect(charge).toHaveBeenCalledTimes(1);
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 2, chargeSentAt: null });
    expect(await held()).toBe(0);
    expect(repo.events()).toEqual([]);
  });

  it("AC7, AC21 (issue 254): on a second submit, no answer and then a dead token is unknown, and the charge is out since it: the first send may be what used it", async () => {
    await leftOut();
    vi.spyOn(payments, "charge").mockRejectedValueOnce(noAnswer()).mockRejectedValueOnce(dead("CARD_TOKEN_USED"));
    expect((await again()).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSentAt: LATER });
  });

  // Which errors refuse a charge is isRefusedCharge's (src/ports/payments-refused-charge.test.ts); here one that is not a dead
  // token, and one that is no refusal.
  const refusedCharge = (): PaymentsError => new PaymentsError({ status: 400, category: "INVALID_REQUEST_ERROR", code: "INVALID_VALUE", detail: SQUARE_TEXT });

  it("AC21 (issue 254): a second submit whose charge Square refuses: error after one send, the charge before it still out as it was, its spot held, no event of its own; the next Pay is sent under its key, and pays", async () => {
    const { row } = await leftOut();
    const charge = vi.spyOn(payments, "charge").mockRejectedValueOnce(refusedCharge());
    expect((await again()).outcome).toBe("error");
    expect(charge).toHaveBeenCalledTimes(1);
    expect(await pending()).toMatchObject({ ledgerId: row?.ledgerId, ledgerStatus: "pending", attempt: 1, chargeSentAt: NOW });
    expect(await held()).toBe(1);
    expect(kinds()).toEqual(["charge_outcome_unknown"]);
    expect((await again({ sourceId: "cnon:third-card" })).outcome).toBe("paid");
    expect(payments.charges).toMatchObject([{ idempotencyKey: `${row?.ledgerId}:1`, sourceId: "cnon:third-card" }]);
  });

  it("AC8, AC21 (issue 254): a second submit under ten minutes on whose key Square says is already used is unknown, and the row keeps its moment and attempt", async () => {
    await leftOut();
    const used = new IdempotencyKeyReusedError({ status: 400, category: "INVALID_REQUEST_ERROR", code: "IDEMPOTENCY_KEY_REUSED", detail: SQUARE_TEXT });
    vi.spyOn(payments, "charge").mockRejectedValue(used);
    expect((await again({ now: minutesOn(9) })).outcome).toBe("unknown");
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSentAt: NOW });
  });

  // The lookup's own error says nothing about the charge, which Square may have taken: only an error from the charge ends it.
  const lookupRefused = (status: number, code: string): PaymentsError => new PaymentsError({ status, category: "INVALID_REQUEST_ERROR", code, detail: SQUARE_TEXT });

  it.each([
    [400, "INVALID_VALUE"],
    [404, "NOT_FOUND"],
  ])("AC6, AC23 (issue 254): a second submit whose lookup Square refuses (%i %s) is unknown: nothing is charged, the row keeps its moment, its attempt and its spot, and the event carries the code", async (status, code) => {
    const { row } = await leftOut();
    vi.spyOn(payments, "findPaymentByReference").mockRejectedValueOnce(lookupRefused(status, code));
    const charge = vi.spyOn(payments, "charge");
    expect((await again()).outcome).toBe("unknown");
    expect(charge).not.toHaveBeenCalled();
    expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSentAt: NOW });
    expect(await held()).toBe(1);
    expect(kinds()).toEqual(["charge_outcome_unknown", "charge_outcome_unknown"]);
    expect(repo.events().at(-1)).toEqual({ kind: "charge_outcome_unknown", memberId: member.id, detail: { ledgerId: row?.ledgerId, code }, actor: asMember() });
  });

  it("AC23 (issue 254): after a lookup Square refused, Pay with another card finds the payment Square had already taken: paid, with no second charge", async () => {
    chargeReplyIsLost(2);
    await submit();
    vi.restoreAllMocks();
    vi.spyOn(payments, "findPaymentByReference").mockRejectedValueOnce(lookupRefused(400, "INVALID_VALUE"));
    await again();
    const charge = vi.spyOn(payments, "charge");
    expect((await again({ sourceId: "cnon:third-card" })).outcome).toBe("paid");
    expect(charge).not.toHaveBeenCalled();
    expect(payments.charges.map((taken) => [taken.sourceId, taken.result.outcome])).toEqual([[SOURCE, "paid"]]);
  });

  it("AC21 (issue 254): a charge Square refuses on the first Pay is error after one send: no charge out, the spot released; the next Pay is sent under the next attempt's key, and pays", async () => {
    const charge = vi.spyOn(payments, "charge").mockRejectedValueOnce(refusedCharge());
    expect((await submit()).outcome).toBe("error");
    expect(charge).toHaveBeenCalledTimes(1);
    const row = await pending();
    expect(row).toMatchObject({ ledgerStatus: "pending", attempt: 2, chargeSentAt: null });
    expect(await held()).toBe(0);
    expect((await submit({ sourceId: OTHER_SOURCE })).outcome).toBe("paid");
    expect(payments.charges).toMatchObject([{ idempotencyKey: `${row?.ledgerId}:2`, sourceId: OTHER_SOURCE }]);
  });
});

/** `n` minutes after NOW, when the first charge of these signups is sent. */
function minutesOn(n: number): Date {
  return new Date(NOW.getTime() + n * 60_000);
}

// Issue 254, AC23: each way a signup could be charged twice, from the first Pay to the last answer. The ten minutes, each
// compare-and-set and every interleaving are takeCharge's (src/ledger-charge.test.ts); here one case of each goes through
// signUp. `payments.charges` is everything Square took or declined, so it counts what the member was charged.
describe("AC23 (issue 254) — a signup is never charged twice", () => {
  const run = (now: Date) =>
    runCharges({ repo, payments, email: new FakeEmail(), now, clock: () => now, siteUrl: "https://members.example.test", accountUrl: "https://members.example.test/account", cardUrl: "https://members.example.test/account/card" });

  /** Every charge Square took or declined: its card, its attempt and what it came to. */
  const taken = () => payments.charges.map((charge) => [charge.sourceId, charge.idempotencyKey.split(":").at(-1), charge.result.outcome]);

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  describe.each<[string, (now: Date) => Promise<unknown>]>([
    ["a second card", async () => undefined],
    ["the charge run, then a second card", run],
  ])("then %s", (_what, beside) => {
    it("AC23: the first charge taken with its answer lost: one payment, the first card's, and the member is subscribed", async () => {
      chargeReplyIsLost(2);
      expect((await submit()).outcome).toBe("unknown");
      await beside(minutesOn(1));
      await again({ now: minutesOn(2) });
      expect(taken()).toEqual([[SOURCE, "1", "paid"]]);
      expect(await active()).not.toBeNull();
    });

    it("AC23: the first charge never reaching Square: one payment, the second card's, under the same key", async () => {
      chargeGetsNoAnswer(2);
      expect((await submit()).outcome).toBe("unknown");
      await beside(minutesOn(1));
      expect((await again({ now: minutesOn(2) })).outcome).toBe("paid");
      expect(taken()).toEqual([[OTHER_SOURCE, "1", "paid"]]);
    });

    it("AC23: the first charge declined with its answer lost, under ten minutes: unknown, nothing taken and the charge still out; at ten minutes: paid once, under the next key", async () => {
      nextCardDeclines();
      chargeReplyIsLost(2);
      expect((await submit()).outcome).toBe("unknown");
      await beside(minutesOn(1));
      expect((await again({ now: minutesOn(9) })).outcome).toBe("unknown");
      expect(taken()).toEqual([[SOURCE, "1", "declined"]]);
      expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1, chargeSentAt: NOW });
      expect((await again({ now: minutesOn(10), sourceId: "cnon:third-card" })).outcome).toBe("paid");
      expect(taken()).toEqual([
        [SOURCE, "1", "declined"],
        ["cnon:third-card", "2", "paid"],
      ]);
    });

    it("AC23: Square took the charge and Haul's write failed: one payment, and the member is subscribed", async () => {
      vi.spyOn(repo, "confirmSignupRows").mockRejectedValueOnce(new Error("write failed"));
      expect((await submit()).outcome).toBe("unknown");
      await beside(minutesOn(1));
      await again({ now: minutesOn(2) });
      expect(taken()).toEqual([[SOURCE, "1", "paid"]]);
      expect(await active()).not.toBeNull();
    });
  });

  it("AC23: two tabs, the second card landing once the first has taken the charge over: one payment, and the member is subscribed", async () => {
    chargeGetsNoAnswer(2);
    await submit();
    vi.restoreAllMocks();
    const real = payments.charge.bind(payments);
    vi.spyOn(payments, "charge").mockImplementationOnce(async (input) => {
      await again({ now: minutesOn(3), sourceId: "cnon:third-card" });
      return real(input);
    });
    await again({ now: minutesOn(2) });
    expect(taken()).toEqual([["cnon:third-card", "1", "paid"]]);
    expect(await active()).not.toBeNull();
  });

  it("AC23: the run alone after a write that failed finds the payment: one payment, and the member is subscribed", async () => {
    vi.spyOn(repo, "confirmSignupRows").mockRejectedValueOnce(new Error("write failed"));
    await submit();
    expect(await run(minutesOn(1))).toMatchObject({ paid: 1 });
    expect(taken()).toEqual([[SOURCE, "1", "paid"]]);
    expect(await active()).not.toBeNull();
  });
});
