// Issue 145: updateCard over the three fakes. The failure rules of AC5, AC6 and AC8 are owned here. Which rows are
// declined, whether a row's week is closed, and what each repository method writes are the repository's rules
// (src/adapters/charge-run-contract.ts); the page and the action only map the outcome to a message. A declined row is
// the fake's `addLedgerRow` seam, as a charge run's decline leaves it. A provider that gives no answer is a spy on one
// method, which falls through to the fake once it is spent, as src/signup.test.ts and src/charge-run.test.ts do.
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
import { updateCard, type UpdateCardResult } from "./update-card.js";

// The Supper Club's weeks: January 3 is the first. By NOW, Wednesday January 20, the cutoffs of January 10, 17 and 24
// have passed (January 24's at the end of Monday the 18th), so each can hold a declined row.
const FIRST = "2027-01-03";
const JAN_10 = "2027-01-10";
const JAN_17 = "2027-01-17";
const JAN_24 = "2027-01-24";
const SIGNED_UP_AT = new Date("2026-12-01T15:00:00.000Z");
const NOW = new Date("2027-01-20T15:00:00.000Z");
/** The clock once a charge's answer is back: the moment `paid_at` records. */
const PAID_AT = new Date("2027-01-20T15:00:30.000Z");
const CLOSED_AT = new Date("2027-01-06T15:00:00.000Z");
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

/** Ada: a member with a Square customer, her signup for January 3 at 5000 with OLD_CARD bound, paid. */
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
  await repo.saveSubscriptionCard(signup.subscriptionId, OLD_CARD);
  expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_SIGNUP", 5000, SIGNED_UP_AT)).toBe("confirmed");
  const member = await repo.findMemberById(saved.id);
  if (!member) throw new Error("the member just saved is gone");
  return { member, customerId, subscriptionId: signup.subscriptionId };
}

/** A declined row for `week`, as a charge run's decline leaves it: attempt 1. Its id. */
const declined = (week: string, cents = 5000): Promise<string> => repo.addLedgerRow(ada.subscriptionId, week, "declined", cents);

const close = (week: string) => repo.closePickupWeek(product.id, week, "Kitchen flooded", CLOSED_AT);

const update = (sourceId: string = SOURCE, clock: () => Date = () => PAID_AT): Promise<UpdateCardResult> =>
  updateCard({ repo, payments, email, siteUrl: SITE_URL, clock }, { memberId: ada.member.id, sourceId });

const AS_ADA = (): Actor => ({ member: ada.member.id });

/** The card on file: its brand and last four. */
const onFile = () => repo.findSubscriptionCard(ada.subscriptionId);
const OLD_ON_FILE = { brand: OLD_CARD.brand, last4: OLD_CARD.last4 };
/** FakePayments saves every card as its sandbox Visa ending 1111. */
const NEW_ON_FILE = { brand: "VISA", last4: "1111" };

/** The ids of Ada's declined rows, oldest week first. */
const declinedIds = async (): Promise<string[]> => (await repo.listDeclinedCharges(ada.subscriptionId)).map((row) => row.ledgerId);

/** Ada's paid weeks and their amounts, by week. */
const paidWeeks = async (): Promise<[string, number][]> =>
  (await repo.listMemberWeeks(ada.subscriptionId)).paid.map((row): [string, number] => [row.weekOf, row.amountCents]).sort(([a], [b]) => a.localeCompare(b));

/** A card Square refuses to save. */
const refusal = (): PaymentsError => new PaymentsError({ status: 402, category: "PAYMENT_METHOD_ERROR", code: "CARD_DECLINED", detail: SQUARE_TEXT });
const noAnswer = (): Error => new DOMException("The operation timed out.", "TimeoutError");

/** Square saves the new card, then declines every charge to it with `code`. */
function newCardDeclines(code: string): void {
  const save = payments.saveCard.bind(payments);
  vi.spyOn(payments, "saveCard").mockImplementation(async (input) => {
    const card = await save(input);
    payments.declineCard(card.id, code);
    return card;
  });
}

/** The `n`th charge (from 1) and every later one decline with `code`; the ones before go to the fake. */
function chargesDeclineFrom(n: number, code: string): void {
  const real = payments.charge.bind(payments);
  let count = 0;
  vi.spyOn(payments, "charge").mockImplementation(async (input) => {
    count++;
    if (count >= n) payments.declineCard(input.cardId, code);
    return real(input);
  });
}

/**
 * The `n`th charge (from 1) gets no answer, and neither does its resend: Square took neither. Every charge before it
 * was answered, so made one call each: the `n`th charge's two calls are calls `n` and `n + 1`. The rest go to the fake.
 */
function chargeGetsNoAnswerAt(n: number) {
  const real = payments.charge.bind(payments);
  let count = 0;
  return vi.spyOn(payments, "charge").mockImplementation(async (input) => {
    count++;
    if (count === n || count === n + 1) throw noAnswer();
    return real(input);
  });
}

/** The receipt the charge run sends for a week, as its member reads it. */
const receipt = (week: PickupWeek, cents: number) => ({
  to: ada.member.email,
  ...renderEmail("receipt", "en", { amount: formatUsdWhole(cents), date: formatPickupDate(clevelandDate(PAID_AT), "en"), week: weekTitle(en, week, "en") }, SITE_URL),
});

/** The new card the update saved: the first card FakePayments holds. With none saved, a card that matches nothing. */
const newCard = (): Card => payments.cards[0] ?? { id: "no card was saved at Square", brand: "", last4: "", expMonth: 0, expYear: 0 };

describe("AC3 — nothing owed: the card is replaced at once", () => {
  it("AC3: with no declined rows, a card Square accepts is saved under the member's Square customer, keyed by the source, and is the subscription's card: saved, nothing charged, no email", async () => {
    const save = vi.spyOn(payments, "saveCard");
    const result = await update();
    expect(result).toEqual({ outcome: "saved", card: newCard() });
    expect(save.mock.calls).toEqual([[expect.objectContaining({ customerId: ada.customerId, sourceId: SOURCE, idempotencyKey: sha256Key(SOURCE) })]]);
    expect(await onFile()).toEqual(NEW_ON_FILE);
    expect(payments.charges).toEqual([]);
    expect(email.sent).toEqual([]);
  });

  it("AC3: when every declined row is a closed week's, nothing is owed: saved at once, nothing charged, and those rows are deleted", async () => {
    await declined(JAN_10);
    await close(JAN_10);
    const result = await update();
    expect(result).toEqual({ outcome: "saved", card: newCard() });
    expect(payments.charges).toEqual([]);
    expect(await onFile()).toEqual(NEW_ON_FILE);
    expect(await declinedIds()).toEqual([]);
    expect(await paidWeeks()).toEqual([[FIRST, 5000]]);
  });
});

describe("AC4 — the declined weeks charged to the new card", () => {
  it("AC4: each declined row is charged to the new card in week order, for its amount, under ledgerId:attempt+1 with the ledger id as reference; each turns paid, and the result is retried with the rows paid", async () => {
    // Written out of week order, so the order charged is the weeks', not the rows'.
    const jan17 = await declined(JAN_17, 8000);
    const jan10 = await declined(JAN_10, 5000);
    const result = await update();
    const card = newCard();
    expect(result).toEqual({
      outcome: "retried",
      card,
      paid: [
        { ledgerId: jan10, pickupDate: JAN_10, amountCents: 5000 },
        { ledgerId: jan17, pickupDate: JAN_17, amountCents: 8000 },
      ],
    });
    expect(payments.charges).toEqual([
      { customerId: ada.customerId, cardId: card.id, amountCents: 5000, idempotencyKey: `${jan10}:2`, referenceId: jan10, result: { outcome: "paid", paymentId: expect.any(String) } },
      { customerId: ada.customerId, cardId: card.id, amountCents: 8000, idempotencyKey: `${jan17}:2`, referenceId: jan17, result: { outcome: "paid", paymentId: expect.any(String) } },
    ]);
    expect(await paidWeeks()).toEqual([
      [FIRST, 5000],
      [JAN_10, 5000],
      [JAN_17, 8000],
    ]);
    expect(await declinedIds()).toEqual([]);
    expect(await onFile()).toEqual(NEW_ON_FILE);
  });

  it("AC4: a paid row is confirmed as the charge run confirms one: its ledger id, Square's payment id, its amount, at the clock's reading once the charge is back", async () => {
    const jan10 = await declined(JAN_10, 8000);
    const real = payments.charge.bind(payments);
    let back = false;
    vi.spyOn(payments, "charge").mockImplementation(async (input) => {
      const answer = await real(input);
      back = true;
      return answer;
    });
    const confirm = vi.spyOn(repo, "confirmSignupRows");
    expect((await update(SOURCE, () => (back ? PAID_AT : NOW))).outcome).toBe("retried");
    const [charged] = payments.charges;
    const paymentId = charged?.result.outcome === "paid" ? charged.result.paymentId : "no payment";
    expect(confirm.mock.calls).toEqual([[jan10, paymentId, 8000, PAID_AT]]);
  });

  it("AC4: a receipt goes out per paid week, the charge run's receipt: the amount, the day charged and the week's days, in week order", async () => {
    await declined(JAN_17, 8000);
    await declined(JAN_10, 5000);
    expect((await update()).outcome).toBe("retried");
    expect(email.sent).toEqual([receipt(pickupWeek(JAN_10, null), 5000), receipt(pickupWeek(JAN_17, null), 8000)]);
  });

  it("AC4: a moved week's receipt names it by its moved days", async () => {
    await declined(JAN_10);
    const moved = { weekOf: JAN_10, closedAt: null, note: null, firstDay: "2027-01-09", lastDay: JAN_10 };
    await repo.savePickupWeek(product.id, moved);
    expect((await update()).outcome).toBe("retried");
    expect(email.sent).toEqual([receipt(pickupWeek(JAN_10, moved), 5000)]);
  });

  it("AC4: a closed week's declined row is never charged: the open weeks' are, and the closed week's is deleted", async () => {
    await declined(JAN_10);
    await close(JAN_10);
    const jan17 = await declined(JAN_17);
    const result = await update();
    expect(result).toEqual({ outcome: "retried", card: newCard(), paid: [{ ledgerId: jan17, pickupDate: JAN_17, amountCents: 5000 }] });
    expect(payments.charges.map((charge) => charge.referenceId)).toEqual([jan17]);
    expect(await declinedIds()).toEqual([]);
    expect(await paidWeeks()).toEqual([
      [FIRST, 5000],
      [JAN_17, 5000],
    ]);
  });

  it("AC4: every write and event the update makes runs as the member", async () => {
    await declined(JAN_10);
    await declined(JAN_17);
    chargesDeclineFrom(2, "INSUFFICIENT_FUNDS");
    const actors: Actor[] = [];
    const realWithActor = repo.withActor.bind(repo);
    vi.spyOn(repo, "withActor").mockImplementation((async (actor: Actor, fn: (scoped: InMemoryRepository) => Promise<unknown>) => {
      actors.push(actor);
      return realWithActor(actor, fn as never);
    }) as never);
    expect((await update()).outcome).toBe("retried");
    expect(actors.length).toBeGreaterThan(0);
    expect(actors).toEqual(actors.map(AS_ADA));
    expect(repo.events().map((event) => event.actor)).toEqual([AS_ADA()]);
  });
});

describe("AC5 — a failed save changes nothing", () => {
  it("AC5: Square refusing to save the card: declined, the old card on file, every row declined, nothing charged, no email, and card_declined with the provider's code as the member, no ledger id", async () => {
    const jan10 = await declined(JAN_10);
    const jan17 = await declined(JAN_17);
    payments.failNext(refusal());
    expect(await update()).toEqual({ outcome: "declined" });
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(await declinedIds()).toEqual([jan10, jan17]);
    expect(payments.charges).toEqual([]);
    expect(email.sent).toEqual([]);
    expect(repo.events()).toEqual([{ kind: "card_declined", memberId: ada.member.id, detail: { code: "CARD_DECLINED" }, actor: AS_ADA() }]);
  });

  it("AC5: with no declined rows, a refused save is the same: declined, the old card kept, the same event", async () => {
    payments.failNext(refusal());
    expect(await update()).toEqual({ outcome: "declined" });
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(repo.events()).toEqual([{ kind: "card_declined", memberId: ada.member.id, detail: { code: "CARD_DECLINED" }, actor: AS_ADA() }]);
  });

  it("AC5: the first retried week declined: declined, the old card on file, every row declined and none after it charged, no email, and card_declined with its ledger id and code", async () => {
    const jan10 = await declined(JAN_10);
    const jan17 = await declined(JAN_17);
    newCardDeclines("INSUFFICIENT_FUNDS");
    expect(await update()).toEqual({ outcome: "declined" });
    expect(payments.charges.map((charge) => [charge.referenceId, charge.result.outcome])).toEqual([[jan10, "declined"]]);
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(await declinedIds()).toEqual([jan10, jan17]);
    expect(await paidWeeks()).toEqual([[FIRST, 5000]]);
    expect(email.sent).toEqual([]);
    expect(repo.events()).toEqual([{ kind: "card_declined", memberId: ada.member.id, detail: { ledgerId: jan10, code: "INSUFFICIENT_FUNDS" }, actor: AS_ADA() }]);
  });

  it("AC5: a failed save deletes no closed week's declined row", async () => {
    const closedRow = await declined(JAN_10);
    await close(JAN_10);
    const open = await declined(JAN_17);
    newCardDeclines("GENERIC_DECLINE");
    expect(await update()).toEqual({ outcome: "declined" });
    expect(await declinedIds()).toEqual([closedRow, open]);
  });
});

describe("AC6 — a later week declined after one paid", () => {
  it("AC6: the first week pays and the second declines: the new card is on file, the paid row stays paid, the declined row and every one after it stay declined, nothing after it is charged; retried with the paid row alone", async () => {
    const jan10 = await declined(JAN_10);
    const jan17 = await declined(JAN_17);
    const jan24 = await declined(JAN_24);
    chargesDeclineFrom(2, "INSUFFICIENT_FUNDS");
    const result = await update();
    expect(result).toEqual({ outcome: "retried", card: newCard(), paid: [{ ledgerId: jan10, pickupDate: JAN_10, amountCents: 5000 }] });
    expect(payments.charges.map((charge) => [charge.referenceId, charge.result.outcome])).toEqual([
      [jan10, "paid"],
      [jan17, "declined"],
    ]);
    expect(await onFile()).toEqual(NEW_ON_FILE);
    expect(await paidWeeks()).toEqual([
      [FIRST, 5000],
      [JAN_10, 5000],
    ]);
    expect(await declinedIds()).toEqual([jan17, jan24]);
  });

  it("AC6: the row after the declined one is not charged, so its attempt is not bumped", async () => {
    await declined(JAN_10);
    await declined(JAN_17);
    const jan24 = await declined(JAN_24);
    chargesDeclineFrom(2, "GENERIC_DECLINE");
    expect((await update()).outcome).toBe("retried");
    expect((await repo.listDeclinedCharges(ada.subscriptionId)).find((row) => row.ledgerId === jan24)?.attempt).toBe(1);
  });

  it("AC6: the paid week's receipt goes out and no decline email does; card_declined records the declined row's ledger id and code", async () => {
    await declined(JAN_10);
    const jan17 = await declined(JAN_17);
    chargesDeclineFrom(2, "INSUFFICIENT_FUNDS");
    expect((await update()).outcome).toBe("retried");
    expect(email.sent).toEqual([receipt(pickupWeek(JAN_10, null), 5000)]);
    expect(repo.events()).toEqual([{ kind: "card_declined", memberId: ada.member.id, detail: { ledgerId: jan17, code: "INSUFFICIENT_FUNDS" }, actor: AS_ADA() }]);
  });
});

describe("AC7 — the charge run charges the new card", () => {
  it("AC7: after a save, the charge run's next firing charges the week to the new card", async () => {
    expect((await update()).outcome).toBe("saved");
    const card = newCard();
    // NOW is after January 24's cutoff: the firing enrols that week and charges it.
    const report = await runCharges({
      repo,
      payments,
      email,
      now: NOW,
      clock: () => PAID_AT,
      siteUrl: SITE_URL,
      accountUrl: `${SITE_URL}/account`,
      cardUrl: `${SITE_URL}/account/card`,
    });
    expect(report).toMatchObject({ weekOf: JAN_24, enrolled: 1, paid: 1 });
    expect(payments.charges.map((charge) => charge.cardId)).toEqual([card.id]);
  });
});

describe("AC8 — a charge with no answer", () => {
  it("AC8: the first retried week gets no answer after its resend: declined, the old card on file, the row declined, no email, and charge_outcome_unknown with its ledger id as the member", async () => {
    const jan10 = await declined(JAN_10);
    const charge = chargeGetsNoAnswerAt(1);
    expect(await update()).toEqual({ outcome: "declined" });
    expect(charge).toHaveBeenCalledTimes(2);
    expect(charge.mock.calls[1]).toEqual(charge.mock.calls[0]);
    expect(await onFile()).toEqual(OLD_ON_FILE);
    expect(await declinedIds()).toEqual([jan10]);
    expect(await paidWeeks()).toEqual([[FIRST, 5000]]);
    expect(email.sent).toEqual([]);
    expect(repo.events()).toEqual([{ kind: "charge_outcome_unknown", memberId: ada.member.id, detail: expect.objectContaining({ ledgerId: jan10 }), actor: AS_ADA() }]);
  });

  it("AC8: nothing turns that row paid by itself; the member's next save retries it, and it pays", async () => {
    const jan10 = await declined(JAN_10);
    chargeGetsNoAnswerAt(1);
    expect(await update()).toEqual({ outcome: "declined" });
    vi.restoreAllMocks();
    expect(await declinedIds()).toEqual([jan10]);
    const result = await update("cnon:another-card");
    expect(result).toMatchObject({ outcome: "retried", paid: [{ ledgerId: jan10, pickupDate: JAN_10, amountCents: 5000 }] });
    expect(await paidWeeks()).toEqual([
      [FIRST, 5000],
      [JAN_10, 5000],
    ]);
  });

  it("AC8: no answer on a row after a paid one is AC6: retried with the paid row, the new card on file, the rest declined, and charge_outcome_unknown for that row", async () => {
    const jan10 = await declined(JAN_10);
    const jan17 = await declined(JAN_17);
    const jan24 = await declined(JAN_24);
    chargeGetsNoAnswerAt(2);
    const result = await update();
    expect(result).toEqual({ outcome: "retried", card: newCard(), paid: [{ ledgerId: jan10, pickupDate: JAN_10, amountCents: 5000 }] });
    expect(await onFile()).toEqual(NEW_ON_FILE);
    expect(await declinedIds()).toEqual([jan17, jan24]);
    expect(repo.events()).toEqual([{ kind: "charge_outcome_unknown", memberId: ada.member.id, detail: expect.objectContaining({ ledgerId: jan17 }), actor: AS_ADA() }]);
  });
});
