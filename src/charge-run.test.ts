// Issue 134: runCharges over the three fakes. Who is due and at what amount, which rows are listed, whether a week is
// closed and when a closed week's row may be deleted are the repository's rules, owned by
// src/adapters/charge-run-contract.ts; the week the run enrols is src/pickup-week.test.ts's. Here each rule takes one
// accepted and one rejected case through the run, and the run's own logic is tested: the charge, the lookup, what it
// records, the emails, the actor and the report. A provider that gives no answer is a spy on one method, which falls
// through to the fake once it is spent, as src/signup.test.ts does.
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { FakePayments } from "./adapters/fake-payments.js";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { upcomingRows } from "./account-weeks.js";
import { CHARGE_RUN_ACTOR, runCharges, type ChargeRunReport } from "./charge-run.js";
import { legalFooter, renderEmail } from "./email-templates.js";
import { createTranslator, type Language } from "./i18n.js";
import type { Member } from "./members.js";
import { formatUsdWhole } from "./money.js";
import { formatPickupDate, pickupWeek, upcomingWeeks, weekTitle } from "./pickup-week.js";
import { EmailSendError } from "./ports/email.js";
import { PaymentsError } from "./ports/payments.js";
import type { Actor, PendingCharge, PendingSignup } from "./ports/repository.js";
import { priceOfChoices, type ProductWithOptions } from "./products.js";
import { errorFields } from "./record-event.js";
import { deliverSignupConfirmation } from "./signup-email.js";

// The Supper Club's weeks: January 3 is the first. January 10's cutoff is the end of Monday the 4th in Cleveland,
// 2027-01-05T05:00Z; January 17's is 2027-01-12T05:00Z.
const FIRST = "2027-01-03";
const WEEK = "2027-01-10";
const NEXT = "2027-01-17";
const SIGNED_UP_AT = new Date("2026-12-01T15:00:00.000Z");
/** Tuesday January 5, 07:00 in Cleveland: January 10's cutoff has passed, January 17's has not. */
const RUN_AT = new Date("2027-01-05T12:00:00.000Z");
/** The clock once a charge's answer is back, the same Cleveland day as RUN_AT. */
const PAID_AT = new Date("2027-01-05T12:00:30.000Z");
const CLOSED_AT = new Date("2027-01-05T18:00:00.000Z");
const SITE_URL = "https://members.example.test";
const ACCOUNT_URL = "https://members.example.test/account";
const SQUARE_TEXT = "Authorization error: the reason Square gave, for member 4242";
const CHARGE_RUN: Actor = { system: "charge-run" };

let repo: InMemoryRepository;
let payments: FakePayments;
let email: FakeEmail;
let product: ProductWithOptions;
let members = 0;

beforeEach(() => {
  repo = new InMemoryRepository();
  payments = new FakePayments();
  email = new FakeEmail();
  product = repo.addProduct({
    name: "Supper Club",
    cap: 50,
    firstPickupDate: FIRST,
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The picks at these positions. */
const picks = (size = 0, menu = 0): Record<string, string> => {
  const [sizes, menus] = product.optionTypes;
  return {
    [sizes?.id ?? "no size type"]: sizes?.options[size]?.id ?? "no such size",
    [menus?.id ?? "no menu type"]: menus?.options[menu]?.id ?? "no such menu",
  };
};

type Subscriber = { member: Member; customerId: string; cardId: string | null; signup: PendingSignup };

/**
 * A member with a Square customer, unless `customer` is false (issue 150; then `card` must be false too), and a signup
 * for `firstWeek` at `choices`: a card saved at Square and bound to the row unless `card` is false, and the first week
 * paid (the subscription active) unless `paid` is false, which leaves a stranded signup. Each is created a moment after
 * the last, so the run's order between them is fixed.
 */
async function subscriber({
  language = "en",
  choices = picks(),
  firstWeek = FIRST,
  card = true,
  paid = true,
  customer = true,
}: { language?: Language; choices?: Record<string, string>; firstWeek?: string; card?: boolean; paid?: boolean; customer?: boolean } = {}): Promise<Subscriber> {
  await new Promise((resolve) => setTimeout(resolve, 2));
  const n = ++members;
  const emailAddress = `member-${n}@example.com`;
  const saved = await repo.saveAccount({ email: emailAddress, firstName: `Member${n}`, lastName: "Lovelace", phone: "216-555-0100", language });
  const customerId = customer ? payments.addCustomer({ email: emailAddress, createdAt: SIGNED_UP_AT, updatedAt: SIGNED_UP_AT }).id : "no customer";
  if (customer) await repo.setMemberSquareCustomer(saved.id, customerId);
  const priceCents = priceOfChoices(product, choices);
  const signup = await repo.savePendingSignup({
    memberId: saved.id,
    productId: product.id,
    choices,
    firstChargeCents: priceCents,
    weeklyCents: priceCents,
    pickupDate: firstWeek,
    consentText: "I agree to a weekly charge until I cancel.",
    consentAt: SIGNED_UP_AT,
  });
  let cardId: string | null = null;
  if (card) {
    cardId = (await payments.saveCard({ customerId, sourceId: `cnon:card-${n}`, idempotencyKey: `card-${n}` })).id;
    expect(await repo.saveSubscriptionCard(signup.subscriptionId, cardId)).toEqual({ amountCents: priceCents, attempt: 1 });
  }
  if (paid) expect(await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_SIGNUP_${n}`, priceCents, SIGNED_UP_AT)).toBe("confirmed");
  const member = await repo.findMemberById(saved.id);
  if (!member) throw new Error("the member just saved is gone");
  return { member, customerId, cardId, signup };
}

const run = (now: Date = RUN_AT, clock: () => Date = () => PAID_AT): Promise<ChargeRunReport> =>
  runCharges({ repo, payments, email, now, clock, siteUrl: SITE_URL, accountUrl: ACCOUNT_URL });

const report = (over: Partial<ChargeRunReport> = {}): ChargeRunReport => ({
  weekOf: WEEK,
  enrolled: 0,
  paid: 0,
  declined: 0,
  unknown: 0,
  dropped: 0,
  ...over,
});

const paidWeeks = async (who: Subscriber): Promise<string[]> =>
  (await repo.listMemberWeeks(who.signup.subscriptionId)).paid.map((row) => row.weekOf).sort();

const pendingIds = async (): Promise<string[]> => (await repo.listPendingCharges(product.id)).map((row) => row.ledgerId);

const close = (week: string = WEEK) => repo.closePickupWeek(product.id, week, "Kitchen flooded", CLOSED_AT);

const noAnswer = (): Error => new DOMException("The operation timed out.", "TimeoutError");
const outage = (): PaymentsError => new PaymentsError({ status: 503, category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: SQUARE_TEXT });
const throttled = (): PaymentsError => new PaymentsError({ status: 429, category: "RATE_LIMIT_ERROR", code: "RATE_LIMITED", detail: SQUARE_TEXT });

/** `times` charges get no answer, and Square took none of them. */
function chargeGetsNoAnswer(times: number, error: () => Error = noAnswer) {
  const charge = vi.spyOn(payments, "charge");
  for (let i = 0; i < times; i++) charge.mockRejectedValueOnce(error());
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

/** What `listPendingCharges` held at each charge, read as the charge goes out; the charge then goes to the fake. */
function pendingAtEachCharge(): PendingCharge[][] {
  const real = payments.charge.bind(payments);
  const seen: PendingCharge[][] = [];
  vi.spyOn(payments, "charge").mockImplementation(async (input) => {
    seen.push(await repo.listPendingCharges(product.id));
    return real(input);
  });
  return seen;
}

/** Square took the stranded signup's charge earlier, under the key and reference signup sends. */
async function squareTookSignup(who: Subscriber, amountCents: number = who.signup.amountCents): Promise<void> {
  await payments.charge({
    customerId: who.customerId,
    cardId: who.cardId ?? "no card",
    amountCents,
    idempotencyKey: amountCents === who.signup.amountCents ? `${who.signup.ledgerId}:1` : "an-earlier-try",
    referenceId: who.signup.ledgerId,
  });
}

describe("AC1, AC2 — who the run enrols", () => {
  it("AC1: a subscription due the week gets a pending row for it, written before the charge, and that row is what is charged and paid", async () => {
    const ada = await subscriber();
    const seen = pendingAtEachCharge();
    expect(await run()).toEqual(report({ enrolled: 1, paid: 1 }));
    expect(seen).toEqual([[expect.objectContaining({ subscriptionId: ada.signup.subscriptionId, pickupDate: WEEK, amountCents: 5000, attempt: 1 })]]);
    expect(payments.charges.map((charge) => charge.referenceId)).toEqual([seen[0]?.[0]?.ledgerId]);
    expect(await paidWeeks(ada)).toEqual([FIRST, WEEK]);
  });

  it("AC1: a subscription cancelled after the week's cutoff, before the run, is due it as of the cutoff: charged and paid", async () => {
    const ada = await subscriber();
    expect(await repo.cancelSubscription(ada.signup.subscriptionId, new Date("2027-01-05T06:00:00.000Z"))).toBe(true);
    expect(await run()).toEqual(report({ enrolled: 1, paid: 1 }));
    expect(await paidWeeks(ada)).toEqual([FIRST, WEEK]);
  });

  it("AC2: a subscription that skipped the week gets no row and no charge; another that did not is charged", async () => {
    const ada = await subscriber();
    const grace = await subscriber();
    expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
    expect(await run()).toEqual(report({ enrolled: 1, paid: 1 }));
    expect(payments.charges.map((charge) => charge.customerId)).toEqual([grace.customerId]);
    expect(await paidWeeks(ada)).toEqual([FIRST]);
  });
});

describe("AC3 — the one week the run enrols", () => {
  it("AC3: only the latest week whose cutoff has passed: an earlier week no firing reached stays without rows, and the week after gets none", async () => {
    const ada = await subscriber();
    // Tuesday January 12: January 17's cutoff has passed; January 10's passed a week ago and no firing reached it.
    expect(await run(new Date("2027-01-12T12:00:00.000Z"), () => new Date("2027-01-12T12:00:30.000Z"))).toEqual(report({ weekOf: NEXT, enrolled: 1, paid: 1 }));
    expect(payments.charges).toHaveLength(1);
    expect(await paidWeeks(ada)).toEqual([FIRST, NEXT]);
    // No row stands in the way of a skip of the missed week or of the one after.
    expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
    expect(await repo.skipWeek(ada.signup.subscriptionId, "2027-01-24")).toBe(true);
  });

  it("AC3: before the first Sunday's cutoff the run enrols nothing and only settles: weekOf null, a stranded signup confirmed", async () => {
    const stranded = await subscriber({ paid: false });
    await squareTookSignup(stranded);
    const before = new Date("2026-12-20T15:00:00.000Z");
    expect(await run(before, () => before)).toEqual(report({ weekOf: null, paid: 1 }));
    expect(await repo.findActiveSubscription(stranded.member.id, product.id)).toEqual({ id: stranded.signup.subscriptionId });
  });
});

describe("AC4 — the charge", () => {
  it("AC4: a pending row is charged for its amount on the subscription's card, to the member's Square customer, key <ledgerId>:<attempt>, referenceId the ledger id", async () => {
    const ada = await subscriber({ choices: picks(1, 1) });
    const seen = pendingAtEachCharge();
    await run();
    const row = seen[0]?.[0];
    expect(row?.ledgerId).toBeDefined();
    expect(payments.charges).toEqual([
      {
        customerId: ada.customerId,
        cardId: ada.cardId,
        amountCents: 8500,
        idempotencyKey: `${row?.ledgerId}:1`,
        referenceId: row?.ledgerId,
        result: { outcome: "paid", paymentId: expect.any(String) },
      },
    ]);
  });

  it("AC4: a charge that throws is sent once more at once with the same request, and that answer is the one recorded", async () => {
    const ada = await subscriber();
    const charge = chargeGetsNoAnswer(1);
    expect(await run()).toEqual(report({ enrolled: 1, paid: 1 }));
    expect(charge).toHaveBeenCalledTimes(2);
    expect(charge.mock.calls[1]).toEqual(charge.mock.calls[0]);
    expect(await paidWeeks(ada)).toEqual([FIRST, WEEK]);
    expect(repo.events()).toEqual([]);
  });

  it("AC4: a pending row whose subscription has no card is left alone: no charge, no event, the row still there", async () => {
    const ada = await subscriber({ card: false });
    const charge = vi.spyOn(payments, "charge");
    expect(await run()).toEqual(report({ enrolled: 1 }));
    expect(charge).not.toHaveBeenCalled();
    expect(repo.events()).toEqual([]);
    // The row stands in the way of a skip, so it is there, and it is not paid.
    expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(false);
    expect(await paidWeeks(ada)).toEqual([FIRST]);
  });
});

/**
 * A row the first firing (at RUN_AT) enrolled and got no answer for, then its week closed. With `squareTook`, Square
 * took the payment and the reply was lost; without, Square took nothing. Spies from the first firing are restored.
 */
async function closedAfterNoAnswer({ squareTook, moved }: { squareTook: boolean; moved?: { firstDay: string; lastDay: string } }) {
  const ada = await subscriber();
  if (squareTook) chargeReplyIsLost(2);
  else chargeGetsNoAnswer(2);
  expect(await run()).toEqual(report({ enrolled: 1, unknown: 1 }));
  vi.restoreAllMocks();
  const [ledgerId] = await pendingIds();
  if (moved) await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, ...moved });
  await close(WEEK);
  return { ada, ledgerId: ledgerId ?? "no row was enrolled" };
}

describe("AC4a — a closed week is never charged", () => {
  it("AC4a: a closed week's row is looked up, not charged: none found, it stays pending while the week's pickup is not over", async () => {
    const { ada, ledgerId } = await closedAfterNoAnswer({ squareTook: false });
    const charge = vi.spyOn(payments, "charge");
    const find = vi.spyOn(payments, "findPaymentByReference");
    // Monday January 11, the week's last pickup day, in Cleveland.
    expect(await run(new Date("2027-01-11T17:00:00.000Z"))).toEqual(report());
    expect(charge).not.toHaveBeenCalled();
    expect(find.mock.calls).toEqual([[{ referenceId: ledgerId, since: ada.signup.createdAt }]]);
    expect(await pendingIds()).toEqual([ledgerId]);
  });

  it("AC4a, AC6: a payment found for a closed week's row is confirmed: the row paid, its week credit granted, a receipt sent, nothing charged", async () => {
    const { ada, ledgerId } = await closedAfterNoAnswer({ squareTook: true });
    const charge = vi.spyOn(payments, "charge");
    expect(await run(new Date("2027-01-06T15:00:00.000Z"))).toEqual(report({ paid: 1 }));
    expect(charge).not.toHaveBeenCalled();
    expect(await paidWeeks(ada)).toEqual([FIRST, WEEK]);
    expect(await repo.listWeekCredits(product.id, WEEK)).toEqual([expect.objectContaining({ subscriptionId: ada.signup.subscriptionId, grantedFor: ledgerId })]);
    expect(email.sent.map((message) => message.to)).toEqual([ada.member.email]);
  });

  it("AC4a: none found once the week's last pickup day is before the run's Cleveland date: the row is deleted and nothing charged", async () => {
    const { ada, ledgerId } = await closedAfterNoAnswer({ squareTook: false });
    // So January 17, whose cutoff has passed by now, enrols nothing to charge.
    expect(await repo.skipWeek(ada.signup.subscriptionId, NEXT)).toBe(true);
    const charge = vi.spyOn(payments, "charge");
    const find = vi.spyOn(payments, "findPaymentByReference");
    // Tuesday January 12 in Cleveland: Monday the 11th, the last pickup day, is over.
    expect(await run(new Date("2027-01-12T12:00:00.000Z"))).toEqual(report({ weekOf: NEXT, dropped: 1 }));
    expect(charge).not.toHaveBeenCalled();
    expect(find.mock.calls).toEqual([[{ referenceId: ledgerId, since: ada.signup.createdAt }]]);
    expect(await pendingIds()).toEqual([]);
    expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
  });

  it("AC4a: the date is Cleveland's: at 23:59 on the last pickup day there, already the next day in UTC, the row is kept", async () => {
    const { ledgerId } = await closedAfterNoAnswer({ squareTook: false });
    const find = vi.spyOn(payments, "findPaymentByReference");
    // 2027-01-12T04:59Z is 23:59 on Monday January 11 in Cleveland.
    expect(await run(new Date("2027-01-12T04:59:00.000Z"))).toEqual(report());
    expect(find).toHaveBeenCalledTimes(1);
    expect(await pendingIds()).toEqual([ledgerId]);
  });

  it("AC4a: a moved week's last pickup day is its moved one: moved to Friday and Saturday, the row goes on Sunday", async () => {
    const { ledgerId } = await closedAfterNoAnswer({ squareTook: false, moved: { firstDay: "2027-01-08", lastDay: "2027-01-09" } });
    expect(ledgerId).not.toBe("no row was enrolled");
    // Sunday January 10 in Cleveland: the ordinary week's Monday is still to come, the moved Saturday is over.
    expect(await run(new Date("2027-01-10T17:00:00.000Z"))).toEqual(report({ dropped: 1 }));
    expect(await pendingIds()).toEqual([]);
  });

  it("AC4a: a lookup that throws is tried once, leaves the row, and records charge_outcome_unknown with the ledger id and the PaymentsError's code, under the charge run", async () => {
    const { ada, ledgerId } = await closedAfterNoAnswer({ squareTook: false });
    const find = vi.spyOn(payments, "findPaymentByReference");
    payments.failNext(outage());
    expect(await run(new Date("2027-01-06T15:00:00.000Z"))).toEqual(report({ unknown: 1 }));
    expect(find).toHaveBeenCalledTimes(1);
    expect(await pendingIds()).toEqual([ledgerId]);
    expect(repo.events()).toEqual([
      // The first firing's: a timeout is not a PaymentsError, so it has no code.
      { kind: "charge_outcome_unknown", memberId: ada.member.id, detail: { ledgerId }, actor: CHARGE_RUN },
      { kind: "charge_outcome_unknown", memberId: ada.member.id, detail: { ledgerId, code: "SERVICE_UNAVAILABLE" }, actor: CHARGE_RUN },
    ]);
  });
});

describe("AC5 — a stranded signup is looked up, never charged", () => {
  it("AC5: the payment Square took is found by the ledger id since the subscription's created_at and confirmed: the subscription active, no charge sent", async () => {
    const stranded = await subscriber({ paid: false });
    await squareTookSignup(stranded);
    const charge = vi.spyOn(payments, "charge");
    const find = vi.spyOn(payments, "findPaymentByReference");
    expect(await run()).toEqual(report({ paid: 1 }));
    expect(find.mock.calls).toEqual([[{ referenceId: stranded.signup.ledgerId, since: stranded.signup.createdAt }]]);
    expect(charge).not.toHaveBeenCalled();
    expect(await repo.findActiveSubscription(stranded.member.id, product.id)).toEqual({ id: stranded.signup.subscriptionId });
    expect(await paidWeeks(stranded)).toEqual([FIRST]);
  });

  it("AC5: none found leaves the row for the member's Try again: no charge, still pending, no email, no event", async () => {
    const stranded = await subscriber({ paid: false });
    const charge = vi.spyOn(payments, "charge");
    const find = vi.spyOn(payments, "findPaymentByReference");
    expect(await run()).toEqual(report());
    expect(find.mock.calls).toEqual([[{ referenceId: stranded.signup.ledgerId, since: stranded.signup.createdAt }]]);
    expect(charge).not.toHaveBeenCalled();
    expect(await repo.findPendingSignup(stranded.member.id, product.id)).toMatchObject({ ledgerId: stranded.signup.ledgerId, ledgerStatus: "pending" });
    expect(email.sent).toEqual([]);
    expect(repo.events()).toEqual([]);
  });

  it("AC5: a lookup that throws leaves the row and records charge_outcome_unknown with the ledger id alone, under the charge run", async () => {
    const stranded = await subscriber({ paid: false });
    payments.failNext(new Error("socket hang up"));
    expect(await run()).toEqual(report({ unknown: 1 }));
    expect(await repo.findPendingSignup(stranded.member.id, product.id)).toMatchObject({ ledgerStatus: "pending" });
    expect(repo.events()).toEqual([
      { kind: "charge_outcome_unknown", memberId: stranded.member.id, detail: { ledgerId: stranded.signup.ledgerId }, actor: CHARGE_RUN },
    ]);
  });

  it("AC5, AC6: the confirmation is at the clock's reading once the lookup is back", async () => {
    const stranded = await subscriber({ paid: false });
    await squareTookSignup(stranded);
    const real = payments.findPaymentByReference.bind(payments);
    let back = false;
    vi.spyOn(payments, "findPaymentByReference").mockImplementation(async (input) => {
      const found = await real(input);
      back = true;
      return found;
    });
    // Before the answer, Tuesday January 5 in Cleveland; after it, Wednesday the 6th.
    await run(RUN_AT, () => (back ? new Date("2027-01-06T15:00:00.000Z") : RUN_AT));
    expect((await repo.findSignupConfirmation(stranded.member.id, product.id))?.chargedDate).toBe("2027-01-06");
  });
});

describe("AC6 — the paid answer", () => {
  it("AC6: a charge's paid answer is confirmed with its payment id, the row's amount, at the clock's reading once the charge is back", async () => {
    const ada = await subscriber({ choices: picks(1, 1) });
    const real = payments.charge.bind(payments);
    let back = false;
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      const result = await real(input);
      back = true;
      return result;
    });
    const confirm = vi.spyOn(repo, "confirmSignupRows");
    const answeredAt = new Date("2027-01-05T12:01:00.000Z");
    await run(RUN_AT, () => (back ? answeredAt : RUN_AT));
    const [charged] = payments.charges;
    const paymentId = charged?.result.outcome === "paid" ? charged.result.paymentId : "no payment";
    expect(confirm.mock.calls).toEqual([[charged?.referenceId, paymentId, 8500, answeredAt]]);
    expect(await paidWeeks(ada)).toEqual([FIRST, WEEK]);
  });

  it("AC6: a week closed while its charge was in flight gets its week credit when the paid answer is confirmed", async () => {
    const ada = await subscriber();
    const real = payments.charge.bind(payments);
    vi.spyOn(payments, "charge").mockImplementationOnce(async (input) => {
      await close(WEEK);
      return real(input);
    });
    expect(await run()).toEqual(report({ enrolled: 1, paid: 1 }));
    const ledgerId = payments.charges[0]?.referenceId;
    expect(await repo.listWeekCredits(product.id, WEEK)).toEqual([expect.objectContaining({ subscriptionId: ada.signup.subscriptionId, grantedFor: ledgerId })]);
  });

  it('AC6: a charge whose confirm says "mismatch" leaves the row pending, records charge_outcome_unknown with the ledger id, chargedCents and ledgerCents, and sends no email', async () => {
    const ada = await subscriber({ choices: picks(1, 1) });
    vi.spyOn(repo, "confirmSignupRows").mockResolvedValueOnce("mismatch");
    expect(await run()).toEqual(report({ enrolled: 1, unknown: 1 }));
    const ledgerId = payments.charges[0]?.referenceId;
    expect(await pendingIds()).toEqual([ledgerId]);
    expect(repo.events()).toEqual([
      { kind: "charge_outcome_unknown", memberId: ada.member.id, detail: { ledgerId, chargedCents: 8500, ledgerCents: 8500 }, actor: CHARGE_RUN },
    ]);
    expect(email.sent).toEqual([]);
  });

  it("AC6: a payment found whose amount is not the row's leaves the stranded signup pending, records both amounts, and sends no email", async () => {
    const stranded = await subscriber({ paid: false });
    await squareTookSignup(stranded, 4200);
    expect(await run()).toEqual(report({ unknown: 1 }));
    expect(await repo.findPendingSignup(stranded.member.id, product.id)).toMatchObject({ ledgerStatus: "pending" });
    expect(repo.events()).toEqual([
      {
        kind: "charge_outcome_unknown",
        memberId: stranded.member.id,
        detail: { ledgerId: stranded.signup.ledgerId, chargedCents: 4200, ledgerCents: 5000 },
        actor: CHARGE_RUN,
      },
    ]);
    expect(email.sent).toEqual([]);
  });
});

describe("AC7 — the receipt", () => {
  const en = createTranslator("en");
  const es = createTranslator("es");

  it("AC7: one receipt to the member, in English: the amount, the date charged and the week's days, then the questions line, the sign-off and the footer", async () => {
    const ada = await subscriber({ choices: picks(1, 1) });
    await run();
    const week = weekTitle(en, pickupWeek(WEEK, null), "en");
    const date = formatPickupDate("2027-01-05", "en");
    expect(email.sent).toEqual([
      {
        to: ada.member.email,
        subject: `Receipt: Supper Club pickup ${week}`,
        text: `Charged ${date}: ${formatUsdWhole(8500)}, for your Supper Club pickup ${week}.\n\n${en("email.signupConfirmation.questions")}\n\n${en("email.signOff")}\n\n${legalFooter(en, SITE_URL)}`,
      },
    ]);
  });

  it("AC7: a member whose language is Spanish gets the receipt in Spanish", async () => {
    const ana = await subscriber({ language: "es" });
    await run();
    const week = weekTitle(es, pickupWeek(WEEK, null), "es");
    const date = formatPickupDate("2027-01-05", "es");
    expect(email.sent).toEqual([
      {
        to: ana.member.email,
        subject: `Recibo: recogida del Supper Club el ${week}`,
        text: `Cobrado el ${date}: ${formatUsdWhole(5000)}, por su recogida del Supper Club el ${week}.\n\n${es("email.signupConfirmation.questions")}\n\n${es("email.signOff")}\n\n${legalFooter(es, SITE_URL)}`,
      },
    ]);
  });

  it("AC7: a moved week is named by its moved days", async () => {
    await subscriber();
    await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-09", lastDay: "2027-01-10" });
    await run();
    const moved = weekTitle(en, { weekOf: WEEK, firstDay: "2027-01-09", lastDay: "2027-01-10" }, "en");
    expect(email.sent.map((message) => message.subject)).toEqual([`Receipt: Supper Club pickup ${moved}`]);
    expect(email.sent.map((message) => message.text)).toEqual([expect.stringContaining(`for your Supper Club pickup ${moved}.`)]);
  });

  it("AC7: the date charged is the clock's day in Cleveland once the answer is back, not the run's start nor UTC's day", async () => {
    await subscriber();
    // 03:30Z on January 7 is 22:30 on Wednesday January 6 in Cleveland.
    await run(RUN_AT, () => new Date("2027-01-07T03:30:00.000Z"));
    expect(email.sent.map((message) => message.text)).toEqual([expect.stringContaining(`Charged ${formatPickupDate("2027-01-06", "en")}: `)]);
  });

  it("AC7: a stranded signup the run confirms gets the signup confirmation, built from findSignupConfirmation with the caller's links, and no receipt", async () => {
    const stranded = await subscriber({ paid: false });
    await squareTookSignup(stranded);
    await run();
    const confirmation = await repo.findSignupConfirmation(stranded.member.id, product.id);
    expect(confirmation).not.toBeNull();
    const expected = new FakeEmail();
    if (confirmation) await deliverSignupConfirmation(expected, stranded.member, confirmation, ACCOUNT_URL, SITE_URL);
    expect(email.sent).toEqual(expected.sent);
  });

  it("AC7, AC11: a failed send is logged with its errorFields and never its message, and undoes nothing: the row stays paid and the next member gets theirs", async () => {
    const ada = await subscriber();
    const grace = await subscriber();
    const failure = new EmailSendError("Resend", 503, "the provider's whole reply, with an address in it");
    vi.spyOn(email, "send").mockRejectedValueOnce(failure);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await run()).toEqual(report({ enrolled: 2, paid: 2 }));
    expect(await paidWeeks(ada)).toEqual([FIRST, WEEK]);
    expect(await paidWeeks(grace)).toEqual([FIRST, WEEK]);
    expect(email.sent.map((message) => message.to)).toEqual([grace.member.email]);
    const args = logged.mock.calls.flat();
    expect(args).toContainEqual(expect.objectContaining(errorFields(failure)));
    expect(inspect(logged.mock.calls, { depth: 5 })).not.toContain("the provider's whole reply");
  });
});

describe("AC8 — a decline", () => {
  it("AC8: a decline turns the row declined and records card_declined with the ledger id and the provider's code under the charge run, and the run goes on", async () => {
    const ada = await subscriber();
    await subscriber();
    payments.declineCard(ada.cardId ?? "no card", "INSUFFICIENT_FUNDS");
    expect(await run()).toEqual(report({ enrolled: 2, paid: 1, declined: 1 }));
    const ledgerId = payments.charges.find((charge) => charge.cardId === ada.cardId)?.referenceId;
    expect(ledgerId).toBeDefined();
    expect(repo.events()).toEqual([{ kind: "card_declined", memberId: ada.member.id, detail: { ledgerId, code: "INSUFFICIENT_FUNDS" }, actor: CHARGE_RUN }]);
    expect(await paidWeeks(ada)).toEqual([FIRST]);
    expect(await pendingIds()).toEqual([]);
  });

  it("AC8: a later run never charges a declined row again", async () => {
    const ada = await subscriber();
    payments.declineCard(ada.cardId ?? "no card", "GENERIC_DECLINE");
    expect(await run()).toEqual(report({ enrolled: 1, declined: 1 }));
    const charge = vi.spyOn(payments, "charge");
    expect(await run(new Date("2027-01-06T15:00:00.000Z"))).toEqual(report());
    expect(charge).not.toHaveBeenCalled();
  });
});

describe("AC9 — no answer", () => {
  it("AC9: no answer after the resend leaves the row pending and records charge_outcome_unknown with the ledger id under the charge run; the next row is still charged", async () => {
    const ada = await subscriber();
    const grace = await subscriber();
    const charge = chargeGetsNoAnswer(2);
    expect(await run()).toEqual(report({ enrolled: 2, paid: 1, unknown: 1 }));
    const ledgerId = charge.mock.calls[0]?.[0].referenceId;
    expect(charge.mock.calls[0]?.[0].customerId).toBe(ada.customerId);
    expect(await pendingIds()).toEqual([ledgerId]);
    expect(repo.events()).toEqual([{ kind: "charge_outcome_unknown", memberId: ada.member.id, detail: { ledgerId }, actor: CHARGE_RUN }]);
    expect(await paidWeeks(grace)).toEqual([FIRST, WEEK]);
  });

  it("AC9: a PaymentsError's code goes in detail.code, so a 429 is countable", async () => {
    const ada = await subscriber();
    const charge = chargeGetsNoAnswer(2, throttled);
    expect(await run()).toEqual(report({ enrolled: 1, unknown: 1 }));
    const ledgerId = charge.mock.calls[0]?.[0].referenceId;
    expect(repo.events()).toEqual([
      { kind: "charge_outcome_unknown", memberId: ada.member.id, detail: { ledgerId, code: "RATE_LIMITED" }, actor: CHARGE_RUN },
    ]);
  });

  it("AC9: the next firing, the week still open, sends the same key again, and the payment Square took comes back as that one, not a second", async () => {
    const ada = await subscriber();
    chargeReplyIsLost(2);
    expect(await run()).toEqual(report({ enrolled: 1, unknown: 1 }));
    const [ledgerId] = await pendingIds();
    vi.restoreAllMocks();
    const charge = vi.spyOn(payments, "charge");
    expect(await run(new Date("2027-01-06T15:00:00.000Z"))).toEqual(report({ paid: 1 }));
    expect(charge.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([`${ledgerId}:1`]);
    expect(payments.charges).toHaveLength(1);
    expect(await paidWeeks(ada)).toEqual([FIRST, WEEK]);
    expect(email.sent).toHaveLength(1);
  });
});

describe("AC10 — fired twice over the same state", () => {
  it("AC10: a second run writes no second row, charges nothing and sends no second receipt", async () => {
    await subscriber();
    expect(await run()).toEqual(report({ enrolled: 1, paid: 1 }));
    const charge = vi.spyOn(payments, "charge");
    expect(await run()).toEqual(report());
    expect(charge).not.toHaveBeenCalled();
    expect(payments.charges).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
  });

  it("AC10: two runs at once enrol one row, charge once and send one receipt: only the run whose confirm answered confirmed emails", async () => {
    await subscriber();
    const reports = await Promise.all([run(), run()]);
    expect(reports.reduce((sum, one) => sum + one.enrolled, 0)).toBe(1);
    expect(reports.reduce((sum, one) => sum + one.paid, 0)).toBe(1);
    expect(payments.charges).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
  });
});

describe("AC11 — the actor and the transactions", () => {
  it("AC11: CHARGE_RUN_ACTOR is the charge run's system actor", () => {
    expect(CHARGE_RUN_ACTOR).toEqual({ system: "charge-run" });
  });

  it("AC11: every withActor call runs under CHARGE_RUN_ACTOR, and no payments or email call starts inside one", async () => {
    await subscriber();
    const declined = await subscriber();
    await subscriber();
    const stranded = await subscriber({ paid: false });
    await squareTookSignup(stranded);
    payments.declineCard(declined.cardId ?? "no card", "GENERIC_DECLINE");

    let depth = 0;
    const actors: Actor[] = [];
    const realWithActor = repo.withActor.bind(repo);
    vi.spyOn(repo, "withActor").mockImplementation((async (actor: Actor, fn: (scoped: InMemoryRepository) => Promise<unknown>) => {
      actors.push(actor);
      depth++;
      try {
        return await realWithActor(actor, fn as never);
      } finally {
        depth--;
      }
    }) as never);
    const insideTransaction: string[] = [];
    const outside: string[] = [];
    const watch = <T extends object>(target: T, method: keyof T & string) => {
      const real = (target[method] as (...args: unknown[]) => Promise<unknown>).bind(target);
      vi.spyOn(target, method as never).mockImplementation((async (...args: unknown[]) => {
        (depth > 0 ? insideTransaction : outside).push(method);
        return real(...args);
      }) as never);
    };
    watch(payments, "charge");
    watch(payments, "findPaymentByReference");
    watch(email, "send");

    await run();
    expect(actors.length).toBeGreaterThan(0);
    expect(actors).toEqual(actors.map(() => CHARGE_RUN));
    expect(outside).toEqual(expect.arrayContaining(["charge", "findPaymentByReference", "send"]));
    expect(insideTransaction).toEqual([]);
  });
});

describe("AC12 — the report", () => {
  it("AC12: a run whose week enrols nobody still names the week, every count zero", async () => {
    expect(await run()).toEqual(report());
  });

  it("AC12: each count is this run's: enrolled what enrolWeek wrote, paid by charge or by lookup, declined, and unknown the events recorded", async () => {
    await subscriber();
    const declined = await subscriber();
    const silent = await subscriber();
    const stranded = await subscriber({ paid: false });
    await squareTookSignup(stranded);
    payments.declineCard(declined.cardId ?? "no card", "GENERIC_DECLINE");
    const real = payments.charge.bind(payments);
    vi.spyOn(payments, "charge").mockImplementation(async (input) => (input.cardId === silent.cardId ? Promise.reject(noAnswer()) : real(input)));
    expect(await run()).toEqual(report({ enrolled: 3, paid: 2, declined: 1, unknown: 1 }));
    expect(repo.events().filter((event) => event.kind === "charge_outcome_unknown")).toHaveLength(1);
  });
});

// Issue 150: a week credit is spent at enrolment. Which credit, on which subscription, and the 0-cent rule are the
// repository's (src/adapters/charge-run-contract.ts owns the spend's edges); here the run's part: the receipt for each
// row a week credit paid, sent after the enrol commits; that such a row, and a 0-cent one, never reaches the settle;
// the report; and one fixture on which upcomingRows' prediction and the spend agree. The receipt's words are
// src/email-templates.test.ts's; here it is rendered as the run must send it.
describe("issue 150 — a week paid by a week credit", () => {
  const en = createTranslator("en");
  const es = createTranslator("es");
  const JAN_24 = "2027-01-24";
  const TITLE = weekTitle(en, pickupWeek(WEEK, null), "en");

  /** The week credit receipt `who` gets for the week titled `week`, in their language. */
  const weekCreditReceipt = (who: Subscriber, week: string) => ({ to: who.member.email, ...renderEmail("weekCreditReceipt", who.member.language, { week }, SITE_URL) });

  /** The weeks of `who`'s paid rows a week credit paid. */
  const paidByWeekCredit = async (who: Subscriber): Promise<string[]> =>
    (await repo.listMemberWeeks(who.signup.subscriptionId)).paid.filter((row) => row.weekCredit).map((row) => row.weekOf).sort();

  // In each case below, FIRST, every subscriber's signup week, closes after it was paid: each holds one unspent week
  // credit, which WEEK, the week the run at RUN_AT enrols, takes.

  it("AC3: a week a week credit paid gets the week credit receipt, to the member in English, naming the week, and no other email", async () => {
    const ada = await subscriber();
    await close(FIRST);
    await run();
    expect(email.sent).toEqual([weekCreditReceipt(ada, TITLE)]);
  });

  it("AC3: a member whose language is Spanish gets it in Spanish", async () => {
    const ana = await subscriber({ language: "es" });
    await close(FIRST);
    await run();
    expect(email.sent).toEqual([weekCreditReceipt(ana, weekTitle(es, pickupWeek(WEEK, null), "es"))]);
  });

  it("AC3: a moved week is named by its moved days, as the receipt names it", async () => {
    const ada = await subscriber();
    await close(FIRST);
    await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-09", lastDay: "2027-01-10" });
    await run();
    expect(email.sent).toEqual([weekCreditReceipt(ada, weekTitle(en, { weekOf: WEEK, firstDay: "2027-01-09", lastDay: "2027-01-10" }, "en"))]);
  });

  it("AC3: a second firing enrols no new row, so it sends no second receipt", async () => {
    const ada = await subscriber();
    await close(FIRST);
    await run();
    expect(await run()).toEqual(report());
    expect(email.sent).toEqual([weekCreditReceipt(ada, TITLE)]);
  });

  it("AC3: a failed send is logged as an email step with its errorFields, never its message, and undoes nothing: the week stays paid by the week credit and the other member gets theirs", async () => {
    const ada = await subscriber();
    const grace = await subscriber();
    await close(FIRST);
    const failure = new EmailSendError("Resend", 503, "the provider's whole reply, with an address in it");
    const send = email.send.bind(email);
    vi.spyOn(email, "send").mockImplementation(async (message) => (message.to === ada.member.email ? Promise.reject(failure) : send(message)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await run();
    expect(await paidByWeekCredit(ada)).toEqual([WEEK]);
    expect(email.sent).toEqual([weekCreditReceipt(grace, TITLE)]);
    expect(logged.mock.calls.flat()).toContainEqual(expect.objectContaining({ step: "email", ...errorFields(failure) }));
    expect(inspect(logged.mock.calls, { depth: 5 })).not.toContain("the provider's whole reply");
  });

  it("AC3: due is not about the card: a member with no card and no Square customer has the week paid by the week credit, and gets its receipt", async () => {
    const ada = await subscriber({ card: false, customer: false });
    await close(FIRST);
    expect(await run()).toEqual(report({ enrolled: 1 }));
    expect(email.sent).toEqual([weekCreditReceipt(ada, TITLE)]);
  });

  it("AC4: a week a week credit paid never reaches the settle: no charge, no lookup, no event; it counts in enrolled", async () => {
    await subscriber();
    await close(FIRST);
    const charge = vi.spyOn(payments, "charge");
    const find = vi.spyOn(payments, "findPaymentByReference");
    expect(await run()).toEqual(report({ enrolled: 1 }));
    expect(charge).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(repo.events()).toEqual([]);
  });

  it("AC4: beside a charged week, each counts once in enrolled, and only the charged one is charged and paid by the run", async () => {
    const ada = await subscriber();
    await close(FIRST);
    // Grace starts at WEEK, paid at signup, so she holds no week credit. The run on Tuesday January 12 enrols NEXT for both.
    const grace = await subscriber({ firstWeek: WEEK });
    expect(await run(new Date("2027-01-12T12:00:00.000Z"), () => new Date("2027-01-12T12:00:30.000Z"))).toEqual(report({ weekOf: NEXT, enrolled: 2, paid: 1 }));
    expect(payments.charges.map((charge) => charge.customerId)).toEqual([grace.customerId]);
    expect(await paidByWeekCredit(ada)).toEqual([NEXT]);
  });

  it("AC5: a week whose picks sum to 0 cents, with no week credit, is enrolled paid: counted in enrolled, never charged, no event and no email", async () => {
    // A Supper Club whose only size and menu are free.
    repo = new InMemoryRepository();
    product = repo.addProduct({
      name: "Supper Club",
      cap: 50,
      firstPickupDate: FIRST,
      cutoffWeekday: 1,
      cutoffTime: "24:00:00",
      optionTypes: [
        { name: "How many people?", position: 1, options: [{ name: "A taste", priceCents: 0, position: 1 }] },
        { name: "Which menu?", position: 2, options: [{ name: "Standard", priceCents: 0, position: 1 }] },
      ],
    });
    const ada = await subscriber();
    const charge = vi.spyOn(payments, "charge");
    expect(await run()).toEqual(report({ enrolled: 1 }));
    expect(charge).not.toHaveBeenCalled();
    expect(repo.events()).toEqual([]);
    expect(email.sent).toEqual([]);
    expect((await repo.listMemberWeeks(ada.signup.subscriptionId)).paid.map((row) => [row.weekOf, row.amountCents, row.weekCredit]).sort()).toEqual([
      [FIRST, 0, false],
      [WEEK, 0, false],
    ]);
  });

  it("AC7: the week upcomingRows marks Week credit before the runs is the week the run pays by the week credit, past a closed week and a skipped one", async () => {
    // Ada's week credit is granted for FIRST; January 10 is closed and January 17 skipped, so it lands on January 24.
    const ada = await subscriber();
    await close(FIRST);
    await close(WEEK);
    expect(await repo.skipWeek(ada.signup.subscriptionId, NEXT)).toBe(true);
    const weeks = upcomingWeeks(product, RUN_AT, await repo.listChangedWeeks(product.id, FIRST), FIRST);
    const predicted = upcomingRows(weeks, await repo.listMemberWeeks(ada.signup.subscriptionId), product)
      .filter((row) => row.marker === "weekCredit")
      .map((row) => row.week.weekOf);
    expect(predicted).toEqual([JAN_24]);
    // A firing after each week's cutoff in turn: January 10's, January 17's, January 24's.
    for (const at of ["2027-01-05T12:00:00.000Z", "2027-01-12T12:00:00.000Z", "2027-01-19T12:00:00.000Z"]) await run(new Date(at), () => new Date(at));
    expect(await paidByWeekCredit(ada)).toEqual(predicted);
  });
});

// Issue 135: the email a decline sends its member, right after the decline is recorded. Its words are new copy, typed
// here once (the template's keys are src/email-templates.test.ts's); the questions line, the sign-off and the footer are
// existing copy, read from the catalog. What a decline records is AC8's, above.
describe("issue 135 — AC3: the decline email", () => {
  const en = createTranslator("en");
  const es = createTranslator("es");
  const TITLE = weekTitle(en, pickupWeek(WEEK, null), "en");

  it("AC3: the declined row's member gets one email in English: the subject naming the week, the body with the amount, the week, the meal still made and the account link, then the questions line, the sign-off and the footer", async () => {
    const ada = await subscriber({ choices: picks(1, 1) });
    payments.declineCard(ada.cardId ?? "no card", "GENERIC_DECLINE");
    expect(await run()).toEqual(report({ enrolled: 1, declined: 1 }));
    expect(email.sent).toEqual([
      {
        to: ada.member.email,
        subject: `Card declined: Supper Club pickup ${TITLE}`,
        text: `Your card was declined for ${formatUsdWhole(8500)}, for your Supper Club pickup ${TITLE}. Your meal is still being made. Please update your card at ${ACCOUNT_URL}.\n\n${en("email.signupConfirmation.questions")}\n\n${en("email.signOff")}\n\n${legalFooter(en, SITE_URL)}`,
      },
    ]);
  });

  it("AC3: a member whose language is Spanish gets it in Spanish", async () => {
    const ana = await subscriber({ language: "es" });
    payments.declineCard(ana.cardId ?? "no card", "GENERIC_DECLINE");
    await run();
    const week = weekTitle(es, pickupWeek(WEEK, null), "es");
    expect(email.sent).toEqual([
      {
        to: ana.member.email,
        subject: `Tarjeta rechazada: recogida del Supper Club el ${week}`,
        text: `Su tarjeta fue rechazada por ${formatUsdWhole(5000)}, por su recogida del Supper Club el ${week}. Su comida se prepara igual. Actualice su tarjeta en ${ACCOUNT_URL}.\n\n${es("email.signupConfirmation.questions")}\n\n${es("email.signOff")}\n\n${legalFooter(es, SITE_URL)}`,
      },
    ]);
  });

  it("AC3: the link is the account URL the run is given, not one the run builds from the site address", async () => {
    const ada = await subscriber();
    payments.declineCard(ada.cardId ?? "no card", "GENERIC_DECLINE");
    const accountUrl = "https://account.example.test/elsewhere";
    await runCharges({ repo, payments, email, now: RUN_AT, clock: () => PAID_AT, siteUrl: SITE_URL, accountUrl });
    expect(email.sent.map((message) => message.text)).toEqual([expect.stringContaining(`Please update your card at ${accountUrl}.`)]);
  });

  it("AC3: a moved week is named by its moved days", async () => {
    const ada = await subscriber();
    payments.declineCard(ada.cardId ?? "no card", "GENERIC_DECLINE");
    await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-09", lastDay: "2027-01-10" });
    await run();
    const moved = weekTitle(en, { weekOf: WEEK, firstDay: "2027-01-09", lastDay: "2027-01-10" }, "en");
    expect(email.sent.map((message) => message.subject)).toEqual([`Card declined: Supper Club pickup ${moved}`]);
  });

  it("AC3: a failed send is logged as an email step with its errorFields, never its message, and undoes nothing: the row stays declined, card_declined stands, and the next member gets their receipt", async () => {
    const ada = await subscriber();
    const grace = await subscriber();
    payments.declineCard(ada.cardId ?? "no card", "INSUFFICIENT_FUNDS");
    const failure = new EmailSendError("Resend", 503, "the provider's whole reply, with an address in it");
    const send = email.send.bind(email);
    vi.spyOn(email, "send").mockImplementation(async (message) => (message.to === ada.member.email ? Promise.reject(failure) : send(message)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await run()).toEqual(report({ enrolled: 2, paid: 1, declined: 1 }));
    expect(logged.mock.calls.flat()).toContainEqual(expect.objectContaining({ step: "email", ...errorFields(failure) }));
    expect(inspect(logged.mock.calls, { depth: 5 })).not.toContain("the provider's whole reply");
    expect(repo.events()).toEqual([expect.objectContaining({ kind: "card_declined", memberId: ada.member.id })]);
    expect(await pendingIds()).toEqual([]);
    // The declined row is still there: it stands in the way of a skip.
    expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(false);
    expect(email.sent.map((message) => message.to)).toEqual([grace.member.email]);
  });

  it("AC3: a second firing sends nothing, since the row is declined, not pending", async () => {
    const ada = await subscriber();
    payments.declineCard(ada.cardId ?? "no card", "GENERIC_DECLINE");
    await run();
    expect(await run(new Date("2027-01-06T15:00:00.000Z"))).toEqual(report());
    expect(email.sent.map((message) => [message.to, message.subject])).toEqual([[ada.member.email, `Card declined: Supper Club pickup ${TITLE}`]]);
  });

  it("AC3 (review): a decline whose row someone else turned declined between the listing and the decline write sends no email", async () => {
    const ada = await subscriber();
    payments.declineCard(ada.cardId ?? "no card", "GENERIC_DECLINE");
    // The race: an overlapping firing, or the member's own retry, records the decline while this run's charge is out.
    const real = payments.charge.bind(payments);
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      await repo.recordSignupDecline(input.referenceId ?? "no reference");
      return real(input);
    });
    await run();
    expect(payments.charges.map((charge) => charge.result.outcome)).toEqual(["declined"]);
    expect(email.sent).toEqual([]);
  });
});
