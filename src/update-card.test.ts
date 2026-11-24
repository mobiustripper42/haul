// Issue 145: updateCard and retryCardCharge over the three fakes. The settle step's rules — what a paid, a declined
// and an unanswered charge write and record, and when an unknown outcome is recorded — are owned here. What the claim
// decides (busy, inactive, a closed week's declined row) and which row Try again reads are the repository's
// (src/adapters/charge-run-contract.ts): here one case each goes through. The page and the actions only map the
// outcome to a message. A declined row is the fake's `addLedgerRow` seam, as a charge run's decline leaves it: with the
// lock (issue 196) a subscription holds one. A provider that gives no answer is a spy on one method, which falls
// through to the fake once it is spent, as src/signup.test.ts and src/charge-run.test.ts do.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { FakePayments } from "./adapters/fake-payments.js";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { runCharges } from "./charge-run.js";
import { sha256Key } from "./customer-match.js";
import { renderEmail } from "./email-templates.js";
import { createTranslator } from "./i18n.js";
import type { Member } from "./members.js";
import { formatUsdWhole } from "./money.js";
import { clevelandDate, formatPickupDate, pickupWeek, weekTitle, type PickupWeek } from "./pickup-week.js";
import { PaymentsError, type Card } from "./ports/payments.js";
import type { Actor } from "./ports/repository.js";
import type { ProductWithOptions } from "./products.js";
import { retryCardCharge, updateCard, type UpdateCardResult } from "./update-card.js";

// The Supper Club's weeks: January 3 is the first. By NOW, Wednesday January 20, the cutoffs of January 17 and 24
// have passed (January 24's at the end of Monday the 18th): January 17's row was declined, and the charge run's next
// firing at NOW enrols January 24.
const FIRST = "2027-01-03";
const JAN_17 = "2027-01-17";
const JAN_24 = "2027-01-24";
const SIGNED_UP_AT = new Date("2026-12-01T15:00:00.000Z");
const NOW = new Date("2027-01-20T15:00:00.000Z");
/** The clock once a charge's answer is back: the moment `paid_at` records. */
const PAID_AT = new Date("2027-01-20T15:00:30.000Z");
const CLOSED_AT = new Date("2027-01-19T15:00:00.000Z");
const SITE_URL = "https://members.example.test";
const SQUARE_TEXT = "Card declined: the reason Square gave, for member 4242";
/** The card on file before the update: not one FakePayments makes, so it is told apart from the new card by brand and last four. */
const OLD_CARD: Card = { id: "ccof:old-card", brand: "MASTERCARD", last4: "4444", expMonth: 1, expYear: 2029 };
const SOURCE = "cnon:new-card";

const en = createTranslator("en");

let repo: InMemoryRepository;
let payments: FakePayments;
let email: FakeEmail;
let product: ProductWithOptions;
let ada: { member: Member; customerId: string; subscriptionId: string };

beforeEach(async () => {
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
      { name: "Which menu?", position: 2, options: [{ name: "Standard", priceCents: 0, position: 1 }] },
    ],
  });
  ada = await subscriber();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Ada: a member with a Square customer, her signup for January 3 at 5000 paid, with OLD_CARD on file. */
async function subscriber() {
  const saved = await repo.saveAccount({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
  const customerId = payments.addCustomer({ email: saved.email, createdAt: SIGNED_UP_AT, updatedAt: SIGNED_UP_AT }).id;
  await repo.setMemberSquareCustomer(saved.id, customerId);
  const choices = Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"]));
  const signup = await repo.savePendingSignup({
    memberId: saved.id,
    productId: product.id,
    choices,
    firstChargeCents: 5000,
    weeklyCents: 5000,
    pickupDate: FIRST,
    consentText: "I agree to a weekly charge until I cancel.",
    consentAt: SIGNED_UP_AT,
  });
  expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_SIGNUP", 5000, SIGNED_UP_AT, OLD_CARD)).toBe("confirmed");
  const member = await repo.findMemberById(saved.id);
  if (!member) throw new Error("the member just saved is gone");
  return { member, customerId, subscriptionId: signup.subscriptionId };
}

/** A declined row for `week`, as a charge run's decline leaves it: attempt 1. Its id. */
const declined = (week: string = JAN_17, cents = 5000): Promise<string> => repo.addLedgerRow(ada.subscriptionId, week, "declined", cents);

const close = (week: string) => repo.closePickupWeek(product.id, week, "Kitchen flooded", CLOSED_AT);

const deps = (clock: () => Date = () => PAID_AT) => ({ repo, payments, email, siteUrl: SITE_URL, clock });

const update = (sourceId: string = SOURCE, clock?: () => Date): Promise<UpdateCardResult> => updateCard(deps(clock), { memberId: ada.member.id, sourceId });

const retry = (): Promise<UpdateCardResult> => retryCardCharge(deps(), { memberId: ada.member.id });

const run = () =>
  runCharges({ repo, payments, email, now: NOW, clock: () => PAID_AT, siteUrl: SITE_URL, accountUrl: `${SITE_URL}/account`, cardUrl: `${SITE_URL}/account/card` });

const AS_ADA = (): Actor => ({ member: ada.member.id });

/** The card on file: its brand and last four. */
const onFile = () => repo.findSubscriptionCard(ada.subscriptionId);
const OLD_ON_FILE = { brand: OLD_CARD.brand, last4: OLD_CARD.last4 };
/** FakePayments saves every card as its sandbox Visa ending 1111. */
const NEW_ON_FILE = { brand: "VISA", last4: "1111" };

/** Ada's declined rows, oldest week first: each id and attempt. */
const declinedRows = async (): Promise<[string, number][]> =>
  (await repo.listDeclinedCharges(ada.subscriptionId)).map((row): [string, number] => [row.ledgerId, row.attempt]);

/** Ada's pending rows as the charge run lists them. */
const pendingRows = async () => (await repo.listPendingCharges(product.id)).filter((row) => row.subscriptionId === ada.subscriptionId);

/** Ada's paid weeks and their amounts, by week. */
const paidWeeks = async (): Promise<[string, number][]> =>
  (await repo.listMemberWeeks(ada.subscriptionId)).paid.map((row): [string, number] => [row.weekOf, row.amountCents]).sort(([a], [b]) => a.localeCompare(b));

/** A card Square refuses to save. */
const refusal = (): PaymentsError => new PaymentsError({ status: 402, category: "PAYMENT_METHOD_ERROR", code: "CARD_DECLINED", detail: SQUARE_TEXT });
const noAnswer = (): Error => new DOMException("The operation timed out.", "TimeoutError");

/** Square declines every charge to the new card's token with `code`. */
function newCardDeclines(code: string): void {
  payments.declineCard(SOURCE, code);
}

/** Every charge, and its resend, gets no answer: Square took neither. */
function chargesGetNoAnswer() {
  return vi.spyOn(payments, "charge").mockRejectedValue(noAnswer());
}

/** Every charge reaches Square and is taken, and its answer is lost: the resend, under the same key, is lost too. */
function chargesTakenWithNoAnswer() {
  const real = payments.charge.bind(payments);
  return vi.spyOn(payments, "charge").mockImplementation(async (input) => {
    await real(input);
    throw noAnswer();
  });
}

/** The receipt the charge run sends for a week, as its member reads it. */
const receipt = (week: PickupWeek, cents: number) => ({
  to: ada.member.email,
  ...renderEmail("receipt", "en", { amount: formatUsdWhole(cents), date: formatPickupDate(clevelandDate(PAID_AT), "en"), week: weekTitle(en, week, "en") }, SITE_URL),
});

/** The new card the update saved: the first card FakePayments holds. With none saved, a card that matches nothing. */
const newCard = (): Card => payments.cards[0] ?? { id: "no card was saved at Square", brand: "", last4: "", expMonth: 0, expYear: 0 };

/** The first lines `console.error` was called with: the log lines. */
const logLines = (spy: { mock: { calls: unknown[][] } }): unknown[] => spy.mock.calls.map((call) => call[0]);

/** A save whose charge got no answer: the declined row is claimed and left pending. Its id. */
async function leftPending(): Promise<string> {
  const jan17 = await declined();
  chargesGetNoAnswer();
  await update();
  vi.restoreAllMocks();
  return jan17;
}

describe("AC3 — nothing owed: the card is replaced at once", () => {
  it("AC3: with no declined rows, a card Square accepts is saved under the member's Square customer, keyed by the source, and is the subscription's card: saved, nothing charged, no email, no event", async () => {
    const save = vi.spyOn(payments, "saveCard");
    expect(await update()).toEqual({ outcome: "saved" });
    expect(save.mock.calls).toEqual([[expect.objectContaining({ customerId: ada.customerId, sourceId: SOURCE, idempotencyKey: sha256Key(SOURCE) })]]);
    expect(await onFile()).toEqual(NEW_ON_FILE);
    expect(payments.charges).toEqual([]);
    expect(email.sent).toEqual([]);
    expect(repo.events()).toEqual([]);
  });

  it("after a save, the charge run's next firing charges the week to the new card", async () => {
    expect((await update()).outcome).toBe("saved");
    const card = newCard();
    expect(await run()).toMatchObject({ weekOf: JAN_24, enrolled: 1, paid: 1 });
    expect(payments.charges.map((charge) => charge.sourceId)).toEqual([card.id]);
  });
});

describe("AC13 — a closed week's declined row is never charged", () => {
  it("AC13: when the declined row's week was closed, the save is the nothing-owed case: saved, nothing charged, the new card on file, and the row deleted", async () => {
    await declined();
    await close(JAN_17);
    expect(await update()).toEqual({ outcome: "saved" });
    expect(payments.charges).toEqual([]);
    expect(await onFile()).toEqual(NEW_ON_FILE);
    expect(await declinedRows()).toEqual([]);
    expect(await pendingRows()).toEqual([]);
  });
});

describe("AC4 — Square refuses to save the card", () => {
  it("AC4: with nothing owed: declined, the old card kept, and card_declined with the provider's code as the member, no ledger id", async () => {
    payments.failNext(refusal());
    expect(await update()).toEqual({ outcome: "declined" });
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(repo.events()).toEqual([{ kind: "card_declined", memberId: ada.member.id, detail: { code: "CARD_DECLINED" }, actor: AS_ADA() }]);
  });
});

describe("AC5 — the claim, then the charge", () => {
  it("AC5, AC9 (issue 254): by the time the week is charged, the row is pending at attempt 2 with the token on it, no longer declined, the old card still on file and no card saved; the charge is the row's amount to the token, buyer-started, under ledgerId:2 with the ledger id as reference", async () => {
    const jan17 = await declined(JAN_17, 8000);
    const real = payments.charge.bind(payments);
    const atCharge: unknown[] = [];
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      atCharge.push(await onFile(), payments.cards, await declinedRows(), (await pendingRows()).map((row) => [row.ledgerId, row.attempt, row.chargeSource]));
      return real(input);
    });
    await update();
    expect(atCharge).toEqual([OLD_ON_FILE, [], [], [[jan17, 2, SOURCE]]]);
    expect(payments.charges).toEqual([
      { customerId: ada.customerId, sourceId: SOURCE, amountCents: 8000, idempotencyKey: `${jan17}:2`, referenceId: jan17, customerInitiated: true, result: { outcome: "paid", paymentId: expect.any(String) } },
    ]);
  });
});

describe("AC6 — the declined week's charge pays", () => {
  it("AC6: paid with the row's ledger id; the row is paid at its amount, nothing is declined or pending, and the new card is on file", async () => {
    const jan17 = await declined();
    expect(await update()).toEqual({ outcome: "paid", ledgerId: jan17 });
    expect(await paidWeeks()).toEqual([
      [FIRST, 5000],
      [JAN_17, 5000],
    ]);
    expect(await declinedRows()).toEqual([]);
    expect(await pendingRows()).toEqual([]);
    expect(await onFile()).toEqual(NEW_ON_FILE);
  });

  it("AC6: the row is confirmed through confirmSignupRows: its ledger id, Square's payment id, its amount, at the clock's reading once the charge is back", async () => {
    const jan17 = await declined(JAN_17, 8000);
    const real = payments.charge.bind(payments);
    let back = false;
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      const answer = await real(input);
      back = true;
      return answer;
    });
    const confirm = vi.spyOn(repo, "confirmSignupRows");
    expect((await update(SOURCE, () => (back ? PAID_AT : NOW))).outcome).toBe("paid");
    const [charged] = payments.charges;
    const paymentId = charged?.result.outcome === "paid" ? charged.result.paymentId : "no payment";
    expect(confirm.mock.calls).toEqual([[jan17, paymentId, 8000, PAID_AT, newCard()]]);
  });

  it("AC6: the receipt goes out, the charge run's receipt: the amount, the day charged and the week's days; nothing is recorded", async () => {
    await declined(JAN_17, 8000);
    expect((await update()).outcome).toBe("paid");
    expect(email.sent).toEqual([receipt(pickupWeek(JAN_17, null), 8000)]);
    expect(repo.events()).toEqual([]);
  });

  it("a moved week's receipt names it by its moved days", async () => {
    await declined();
    const moved = { weekOf: JAN_17, closedAt: null, note: null, firstDay: "2027-01-16", lastDay: JAN_17 };
    await repo.savePickupWeek(product.id, moved);
    expect((await update()).outcome).toBe("paid");
    expect(email.sent).toEqual([receipt(pickupWeek(JAN_17, moved), 5000)]);
  });

  it("AC6: the subscription is no longer locked: the next cutoff's firing enrols its week and charges it to the new card, locking nothing", async () => {
    await declined();
    expect((await update()).outcome).toBe("paid");
    const card = newCard();
    expect(await run()).toMatchObject({ weekOf: JAN_24, enrolled: 1, paid: 1, locked: 0 });
    expect(payments.charges.map((charge) => [charge.amountCents, charge.sourceId, charge.result.outcome])).toEqual([
      [5000, SOURCE, "paid"],
      [5000, card.id, "paid"],
    ]);
  });

  it("every write and event the update makes runs as the member", async () => {
    await declined();
    newCardDeclines("INSUFFICIENT_FUNDS");
    const actors: Actor[] = [];
    const realWithActor = repo.withActor.bind(repo);
    vi.spyOn(repo, "withActor").mockImplementation((async (actor: Actor, fn: (scoped: InMemoryRepository) => Promise<unknown>) => {
      actors.push(actor);
      return realWithActor(actor, fn as never);
    }) as never);
    expect((await update()).outcome).toBe("declined");
    expect(actors.length).toBeGreaterThan(0);
    expect(actors).toEqual(actors.map(AS_ADA));
    expect(repo.events().map((event) => event.actor)).toEqual([AS_ADA()]);
  });
});

describe("AC8 — the declined week's charge gets no answer", () => {
  it("AC8: a charge and its resend with no answer: unknown; the row stays pending under its key with the token, the old card on file, charge_outcome_unknown records its ledger id as the member, and no email is sent", async () => {
    const jan17 = await declined();
    const charge = chargesGetNoAnswer();
    expect(await update()).toEqual({ outcome: "unknown" });
    expect(charge).toHaveBeenCalledTimes(2);
    expect(charge.mock.calls[1]).toEqual(charge.mock.calls[0]);
    expect(charge.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey: `${jan17}:2` });
    expect((await pendingRows()).map((row) => [row.ledgerId, row.attempt, row.chargeSource])).toEqual([[jan17, 2, SOURCE]]);
    expect(await declinedRows()).toEqual([]);
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(email.sent).toEqual([]);
    expect(repo.events()).toEqual([{ kind: "charge_outcome_unknown", memberId: ada.member.id, detail: { ledgerId: jan17 }, actor: AS_ADA() }]);
  });
});

describe("AC9 — Try again", () => {
  it("AC9: Square is asked first, for a payment under the row's reference since the subscription was made; one it took is confirmed without a second charge: paid, and the receipt goes out once", async () => {
    const jan17 = await declined();
    chargesTakenWithNoAnswer();
    await update();
    vi.restoreAllMocks();
    const [row] = await pendingRows();
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    const charge = vi.spyOn(payments, "charge");
    expect(await retry()).toEqual({ outcome: "paid", ledgerId: jan17 });
    expect(lookup.mock.calls).toEqual([[{ referenceId: jan17, since: row?.createdAt }]]);
    expect(charge).not.toHaveBeenCalled();
    expect(payments.charges).toHaveLength(1);
    expect(await paidWeeks()).toEqual([
      [FIRST, 5000],
      [JAN_17, 5000],
    ]);
    expect(email.sent).toEqual([receipt(pickupWeek(JAN_17, null), 5000)]);
  });

  it("AC9: with no payment found, only after the lookup is the row charged, under the same key and token: paid", async () => {
    const jan17 = await leftPending();
    const lookup = vi.spyOn(payments, "findPaymentByReference");
    const charge = vi.spyOn(payments, "charge");
    expect(await retry()).toEqual({ outcome: "paid", ledgerId: jan17 });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.invocationCallOrder[0]).toBeLessThan(charge.mock.invocationCallOrder[0] ?? 0);
    expect(payments.charges).toEqual([
      { customerId: ada.customerId, sourceId: SOURCE, amountCents: 5000, idempotencyKey: `${jan17}:2`, referenceId: jan17, customerInitiated: true, result: { outcome: "paid", paymentId: expect.any(String) } },
    ]);
    expect(await paidWeeks()).toEqual([
      [FIRST, 5000],
      [JAN_17, 5000],
    ]);
  });

  it("AC9: a Try again declined: declined, the row declined, the old card on file, card_declined with its ledger id and code, no email", async () => {
    const jan17 = await leftPending();
    newCardDeclines("GENERIC_DECLINE");
    expect(await retry()).toEqual({ outcome: "declined" });
    expect(await declinedRows()).toEqual([[jan17, 2]]);
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(email.sent).toEqual([]);
    expect(repo.events()).toEqual([
      expect.objectContaining({ kind: "charge_outcome_unknown", detail: { ledgerId: jan17 } }),
      { kind: "card_declined", memberId: ada.member.id, detail: { ledgerId: jan17, code: "GENERIC_DECLINE" }, actor: AS_ADA() },
    ]);
  });

  it("AC9 [you]: a row whose week was closed after it went pending is still charged by Try again, and its confirm grants the week credit", async () => {
    const jan17 = await leftPending();
    await close(JAN_17);
    expect(await retry()).toEqual({ outcome: "paid", ledgerId: jan17 });
    expect(payments.charges.map((charge) => charge.referenceId)).toEqual([jan17]);
    expect((await repo.listMemberWeeks(ada.subscriptionId)).weekCredits).toEqual([{ grantedForWeek: JAN_17 }]);
  });
});

describe("AC10 — a save while a charge is out", () => {
  it("AC10: a second save while the claimed row is pending: unknown, nothing charged or saved, no event: the row keeps the first token", async () => {
    const jan17 = await leftPending();
    const charge = vi.spyOn(payments, "charge");
    expect(await update("cnon:another-card")).toEqual({ outcome: "unknown" });
    expect(charge).not.toHaveBeenCalled();
    expect(payments.cards).toEqual([]);
    expect((await pendingRows()).map((row) => [row.ledgerId, row.attempt, row.chargeSource])).toEqual([[jan17, 2, SOURCE]]);
    expect(repo.events().map((event) => event.kind)).toEqual(["charge_outcome_unknown"]);
  });
});

describe("AC11 — a failure before any charge is sent", () => {
  it("AC11: the claim failing: error, logged as the card update's, nothing charged or saved, the old card on file, the row declined at its attempt, and no event at all", async () => {
    const jan17 = await declined();
    vi.spyOn(repo, "claimCardUpdate").mockRejectedValueOnce(new Error("the claim failed"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await update()).toEqual({ outcome: "error" });
    expect(logLines(logged)).toContain("card update step failed");
    expect(payments.charges).toEqual([]);
    expect(payments.cards).toEqual([]);
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(await declinedRows()).toEqual([[jan17, 1]]);
    expect(repo.events()).toEqual([]);
  });

  it("AC11: Try again's lookup failing: error, logged, nothing charged, the row still pending, and no event beyond the earlier unknown", async () => {
    const jan17 = await leftPending();
    vi.spyOn(payments, "findPaymentByReference").mockRejectedValueOnce(new Error("Square's lookup failed"));
    const charge = vi.spyOn(payments, "charge");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await retry()).toEqual({ outcome: "error" });
    expect(logLines(logged)).toContain("card update step failed");
    expect(charge).not.toHaveBeenCalled();
    expect((await pendingRows()).map((row) => row.ledgerId)).toEqual([jan17]);
    expect(repo.events().map((event) => event.kind)).toEqual(["charge_outcome_unknown"]);
  });

  it("AC11, AC13 (issue 254): with nothing owed, a subscription cancelled while Square saved the card: error, nothing charged, the old card on file, no event", async () => {
    const save = payments.saveCard.bind(payments);
    vi.spyOn(payments, "saveCard").mockImplementation(async (input) => {
      await repo.cancelSubscription(ada.subscriptionId, NOW);
      return save(input);
    });
    expect(await update()).toEqual({ outcome: "error" });
    expect(payments.charges).toEqual([]);
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(repo.events()).toEqual([]);
  });
});

// Issue 254: with a week owed the token is charged, then the card is saved from the payment; with nothing owed the card is
// saved alone. What settling a paid charge saves, confirms and records is settlePaid's (src/ledger-charge.test.ts); what the
// claim, replaceSubscriptionCard and abandonCharge decide and write is the repository's. Here each goes through once.
describe("issue 254 — charge the token, then save the card", () => {
  const dead = (code = "CARD_TOKEN_EXPIRED"): PaymentsError => new PaymentsError({ status: 400, category: "INVALID_REQUEST_ERROR", code, detail: SQUARE_TEXT });
  const paymentId = (): string => {
    const result = payments.charges[0]?.result;
    return result?.outcome === "paid" ? result.paymentId : "no payment";
  };

  it("AC9 (issue 254): a blank sourceId is error: nothing is charged or saved, and the row stays declined at its attempt", async () => {
    const jan17 = await declined();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await update("")).toEqual({ outcome: "error" });
    expect(payments.charges).toEqual([]);
    expect(payments.cards).toEqual([]);
    expect(await declinedRows()).toEqual([[jan17, 1]]);
    expect(await pendingRows()).toEqual([]);
  });

  // Square's CreatePayment takes these two words as money received outside Square, so a browser's text must never be one.
  it.each(["CASH", "EXTERNAL"])("AC9 (issue 254): a sourceId of %s with a week owed is error, as a blank one is: nothing is charged or saved, and the row stays declined at its attempt", async (word) => {
    const jan17 = await declined();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const charge = vi.spyOn(payments, "charge");
    const save = vi.spyOn(payments, "saveCard");
    const result = await update(word);
    expect(charge).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "error" });
    expect(save).not.toHaveBeenCalled();
    expect(await declinedRows()).toEqual([[jan17, 1]]);
    expect(await pendingRows()).toEqual([]);
  });

  it.each(["CASH", "EXTERNAL"])("AC13 (issue 254): a sourceId of %s with nothing owed is error, as a blank one is: nothing is charged, and no save is sent to Square", async (word) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const charge = vi.spyOn(payments, "charge");
    const save = vi.spyOn(payments, "saveCard");
    const result = await update(word);
    expect(save).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "error" });
    expect(await onFile()).toEqual(OLD_ON_FILE);
  });

  it("AC10 (issue 254): a paid charge's card is saved once, from the payment's id, under its SHA-256, and replaces the card on file; a closed week's declined row is deleted; the receipt goes once", async () => {
    const jan17 = await declined();
    await declined(JAN_24);
    await close(JAN_24);
    const save = vi.spyOn(payments, "saveCard");
    expect(await update()).toEqual({ outcome: "paid", ledgerId: jan17 });
    expect(save.mock.calls).toStrictEqual([[{ customerId: ada.customerId, sourceId: paymentId(), idempotencyKey: sha256Key(paymentId()) }]]);
    expect(await onFile()).toEqual(NEW_ON_FILE);
    expect(await declinedRows()).toEqual([]);
    expect(email.sent).toEqual([receipt(pickupWeek(JAN_17, null), 5000)]);
  });

  it("AC10 (issue 254): a paid charge whose card Square refuses to save: paidNoCard with the ledger id, the row paid, the old card on file, a closed week's declined row kept, card_not_saved as the member, and the receipt once", async () => {
    const jan17 = await declined();
    const closed = await declined(JAN_24);
    await close(JAN_24);
    vi.spyOn(payments, "saveCard").mockRejectedValueOnce(refusal());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await update()).toEqual({ outcome: "paidNoCard", ledgerId: jan17 });
    expect((await paidWeeks()).map(([week]) => week)).toEqual([FIRST, JAN_17]);
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(await declinedRows()).toEqual([[closed, 1]]);
    expect(repo.events()).toEqual([{ kind: "card_not_saved", memberId: ada.member.id, detail: { ledgerId: jan17, paymentId: paymentId(), code: "CARD_DECLINED" }, actor: AS_ADA() }]);
    expect(email.sent).toEqual([receipt(pickupWeek(JAN_17, null), 5000)]);
  });

  it("AC10 (issue 254): a failed save whose row another confirm paid meanwhile is paid, with no card_not_saved and no second receipt", async () => {
    const jan17 = await declined();
    vi.spyOn(payments, "saveCard").mockImplementationOnce(async () => {
      await repo.confirmSignupRows(jan17, paymentId(), 5000, PAID_AT);
      throw refusal();
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await update()).toEqual({ outcome: "paid", ledgerId: jan17 });
    expect((await paidWeeks()).map(([week]) => week)).toEqual([FIRST, JAN_17]);
    expect(repo.events()).toEqual([]);
    expect(email.sent).toEqual([]);
  });

  it("AC11 (issue 254): a declined charge: declined, the row declined at its new attempt, no card saved and the old one on file, card_declined with the ledger id and code once as the member, no email", async () => {
    const jan17 = await declined();
    newCardDeclines("INSUFFICIENT_FUNDS");
    expect(await update()).toEqual({ outcome: "declined" });
    expect(payments.charges.map((charge) => [charge.idempotencyKey, charge.result.outcome])).toEqual([[`${jan17}:2`, "declined"]]);
    expect(await declinedRows()).toEqual([[jan17, 2]]);
    expect(await pendingRows()).toEqual([]);
    expect(payments.cards).toEqual([]);
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(email.sent).toEqual([]);
    expect(repo.events()).toEqual([{ kind: "card_declined", memberId: ada.member.id, detail: { ledgerId: jan17, code: "INSUFFICIENT_FUNDS" }, actor: AS_ADA() }]);
  });

  it("AC12 (issue 254): Try again that finds the payment saves the card from it: paid, nothing more charged, the new card on file", async () => {
    const jan17 = await declined();
    chargesTakenWithNoAnswer();
    await update();
    vi.restoreAllMocks();
    const save = vi.spyOn(payments, "saveCard");
    expect(await retry()).toEqual({ outcome: "paid", ledgerId: jan17 });
    expect(payments.charges).toHaveLength(1);
    expect(save.mock.calls.map(([input]) => input.sourceId)).toEqual([paymentId()]);
    expect(await onFile()).toEqual(NEW_ON_FILE);
  });

  it("AC12 (issue 254): Try again that finds none resends the very same charge, and saves the card from the payment it makes", async () => {
    const jan17 = await declined();
    const out = chargesGetNoAnswer();
    await update();
    const sent = out.mock.calls[0]?.[0];
    vi.restoreAllMocks();
    const charge = vi.spyOn(payments, "charge");
    expect(await retry()).toEqual({ outcome: "paid", ledgerId: jan17 });
    expect(sent).toMatchObject({ sourceId: SOURCE, customerInitiated: true });
    expect(charge.mock.calls).toEqual([[sent]]);
    expect(await onFile()).toEqual(NEW_ON_FILE);
  });

  it("AC12 (issue 254): Try again whose resend answers a dead token: error after one send, the row declined again at its attempt, the old card on file, and no event of its own", async () => {
    const jan17 = await leftPending();
    const charge = vi.spyOn(payments, "charge").mockRejectedValue(dead());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await retry()).toEqual({ outcome: "error" });
    expect(charge).toHaveBeenCalledTimes(1);
    expect(await declinedRows()).toEqual([[jan17, 2]]);
    expect(await pendingRows()).toEqual([]);
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(repo.events().map((event) => event.kind)).toEqual(["charge_outcome_unknown"]);
  });

  it("AC12 (issue 254): the next save after a dead token is charged under the next attempt's key with the new token, and pays", async () => {
    const jan17 = await leftPending();
    vi.spyOn(payments, "charge").mockRejectedValueOnce(dead());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await retry();
    expect(await update("cnon:another-card")).toEqual({ outcome: "paid", ledgerId: jan17 });
    expect(payments.charges).toMatchObject([{ idempotencyKey: `${jan17}:3`, sourceId: "cnon:another-card" }]);
  });

  it("AC12 (issue 254): a dead token whose row another tab settled first is error too", async () => {
    await leftPending();
    vi.spyOn(payments, "charge").mockRejectedValueOnce(dead());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abandon = vi.spyOn(repo, "abandonCharge").mockResolvedValueOnce(null);
    expect(await retry()).toEqual({ outcome: "error" });
    expect(abandon).toHaveBeenCalledTimes(1);
  });

  it("AC12 (issue 254): a dead token on the first Save is unknown after one send, with the token kept on the row", async () => {
    const jan17 = await declined();
    const charge = vi.spyOn(payments, "charge").mockRejectedValue(dead());
    expect(await update()).toEqual({ outcome: "unknown" });
    expect(charge).toHaveBeenCalledTimes(1);
    expect((await pendingRows()).map((row) => [row.ledgerId, row.attempt, row.chargeSource])).toEqual([[jan17, 2, SOURCE]]);
  });

  it("AC13 (issue 254): with nothing owed, a row that went pending while Square saved the card: unknown, nothing charged, the old card on file, no event", async () => {
    const save = payments.saveCard.bind(payments);
    vi.spyOn(payments, "saveCard").mockImplementationOnce(async (input) => {
      await repo.addLedgerRow(ada.subscriptionId, JAN_24, "pending", 5000);
      return save(input);
    });
    expect(await update()).toEqual({ outcome: "unknown" });
    expect(payments.charges).toEqual([]);
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(repo.events()).toEqual([]);
  });

  it("AC16 (issue 254): Try again on a charge run's row charges the card on file, seller-started, and saves no card from the payment", async () => {
    expect(await update()).toEqual({ outcome: "saved" });
    const card = newCard();
    const jan24 = await repo.addLedgerRow(ada.subscriptionId, JAN_24, "pending", 5000);
    const save = vi.spyOn(payments, "saveCard");
    expect(await retry()).toEqual({ outcome: "paid", ledgerId: jan24 });
    expect(payments.charges).toMatchObject([{ sourceId: card.id, customerInitiated: false, referenceId: jan24 }]);
    expect(save).not.toHaveBeenCalled();
  });
});
