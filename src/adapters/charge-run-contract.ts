/**
 * The charge run's repository contract (issue 134), run against both adapters like `runWeekCreditContract` (DEC-010),
 * with the same arguments and seams: `addLedgerRow`, a ledger row as an earlier firing would have left it, returning
 * its id.
 *
 * The rules owned here: who is due a week and at what amount (`enrolWeek`, AC1, AC2, AC10), which rows the run settles
 * and what it is told about each (`listPendingCharges`), whether "the week is closed" (its `closed`, AC4a), and when a
 * closed week's row may be deleted (`dropClosedWeekRow`, AC4a). The repository checks no date: the run compares the
 * last pickup day with Cleveland's (src/charge-run.test.ts).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { cutoffInstant } from "../pickup-week.js";
import type { PendingCharge, PendingSignup, Repository } from "../ports/repository.js";
import type { ProductInput, ProductWithOptions } from "../products.js";
import { BOX, UNKNOWN_UUID, UUID } from "./contract-helpers.js";

type LedgerStatus = PendingSignup["ledgerStatus"];

export function runChargeRunContract(
  name: string,
  make: () => Promise<Repository>,
  addProduct: (input: ProductInput) => Promise<ProductWithOptions>,
  addLedgerRow: (subscriptionId: string, pickupDate: string, status: LedgerStatus, amountCents: number) => Promise<string>,
  _spendWeekCredit: (weekCreditId: string, ledgerId: string) => Promise<void>,
  reset?: () => Promise<void>,
): void {
  // BOX's weeks: January 24's cutoff is the end of Monday the 18th in Cleveland, 2027-01-19T05:00Z. The repository
  // checks no clock, so the times here are only what each call is given.
  describe(`Charge run repository contract — ${name}`, () => {
    const EARLIER = "2027-01-17";
    const WEEK = "2027-01-24";
    const NEXT = "2027-01-31";
    const FEB_7 = "2027-02-07";
    const FEB_14 = "2027-02-14";
    const FEB_21 = "2027-02-21";
    const CONSENT_AT = new Date("2027-01-05T15:00:00.000Z");
    const PAID_AT = new Date("2027-01-05T15:00:05.000Z");
    const CLOSED_AT = new Date("2027-01-20T15:00:00.000Z");

    let repo: Repository;
    let product: ProductWithOptions;
    let members = 0;

    beforeEach(async () => {
      if (reset) await reset();
      repo = await make();
      product = await addProduct(BOX);
    });

    /** The option ids at `size` and `menu` of `on`, as choices: option type id → option id. */
    const choices = (size: number, menu: number, on: ProductWithOptions = product): Record<string, string> => {
      const [sizes, menus] = on.optionTypes;
      return {
        [sizes?.id ?? "no size type"]: sizes?.options[size]?.id ?? "no such size",
        [menus?.id ?? "no menu type"]: menus?.options[menu]?.id ?? "no such menu",
      };
    };

    type Subscriber = { memberId: string; customerId: string; cardId: string | null; signup: PendingSignup };

    /**
     * A new member with a Square customer, and their signup for `firstWeek` at the first size and menu (5000): a card
     * bound unless `card` is false, and paid (the subscription active) unless `paid` is false.
     */
    const subscriber = async (
      { firstWeek = EARLIER, card = true, paid = true, on = product }: { firstWeek?: string; card?: boolean; paid?: boolean; on?: ProductWithOptions } = {},
    ): Promise<Subscriber> => {
      const n = ++members;
      const memberId = (await repo.createMember({ email: `member-${n}@example.com` })).id;
      const customerId = `CUSTOMER_${n}`;
      await repo.setMemberSquareCustomer(memberId, customerId);
      const signup = await repo.savePendingSignup({
        memberId,
        productId: on.id,
        choices: choices(0, 0, on),
        firstChargeCents: 5000,
        weeklyCents: 5000,
        pickupDate: firstWeek,
        consentText: "I agree to a weekly charge of $50.",
        consentAt: CONSENT_AT,
      });
      const cardId = card ? `ccof:card-${n}` : null;
      if (cardId !== null) expect(await repo.saveSubscriptionCard(signup.subscriptionId, cardId)).toEqual({ amountCents: 5000, attempt: 1 });
      if (paid) expect(await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, 5000, PAID_AT)).toBe("confirmed");
      return { memberId, customerId, cardId, signup };
    };

    const enrol = (week: string = WEEK, of: ProductWithOptions = product) => repo.enrolWeek(of.id, week, cutoffInstant(of, week));
    const pendingRows = (of: ProductWithOptions = product) => repo.listPendingCharges(of.id);
    const rowsOf = async (who: Subscriber) => (await pendingRows()).filter((row) => row.subscriptionId === who.signup.subscriptionId);
    const close = (week: string) => repo.closePickupWeek(product.id, week, "Kitchen flooded", CLOSED_AT);

    /** A pause long enough that the next subscription's created_at is later, on the fake's clock too. */
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

    // The due predicate's edges are owned here; listWeekDue shares it (AC13, src/adapters/week-credit-contract.ts),
    // and src/charge-run.test.ts takes one accepted and one rejected case through the run.
    describe("AC1, AC2, AC10 — enrolWeek", () => {
      it("AC1: each active subscription whose first paid week is earlier gets a pending row for the week, attempt 1, at the sum of its picks; it returns how many", async () => {
        const ada = await subscriber();
        await tick();
        const grace = await subscriber();
        expect(await enrol()).toBe(2);
        expect(await pendingRows()).toEqual([
          expect.objectContaining({ subscriptionId: ada.signup.subscriptionId, pickupDate: WEEK, amountCents: 5000, attempt: 1, ledgerId: expect.stringMatching(UUID) }),
          expect.objectContaining({ subscriptionId: grace.signup.subscriptionId, pickupDate: WEEK, amountCents: 5000, attempt: 1, ledgerId: expect.stringMatching(UUID) }),
        ]);
      });

      it("AC1 (DEC-033): the amount is the sum of the picks in effect for the week, not weekly_cents", async () => {
        const ada = await subscriber();
        expect(await repo.switchPicks(ada.signup.subscriptionId, choices(1, 1), WEEK, 4200)).toBe("switched");
        expect(await enrol()).toBe(1);
        expect((await rowsOf(ada)).map((row) => row.amountCents)).toEqual([8000]);
      });

      it("AC1 (DEC-033): a set that starts after the week is not the week's: the earlier set is charged", async () => {
        const ada = await subscriber();
        expect(await repo.switchPicks(ada.signup.subscriptionId, choices(1, 0), NEXT, 8000)).toBe("switched");
        expect(await enrol()).toBe(1);
        expect((await rowsOf(ada)).map((row) => row.amountCents)).toEqual([5000]);
      });

      it("AC1: a subscription cancelled at the week's cutoff instant is due, and so is one cancelled after it", async () => {
        const cutoff = cutoffInstant(product, WEEK);
        const atCutoff = await subscriber();
        const after = await subscriber();
        expect(await repo.cancelSubscription(atCutoff.signup.subscriptionId, cutoff)).toBe(true);
        expect(await repo.cancelSubscription(after.signup.subscriptionId, new Date(cutoff.getTime() + 60 * 60 * 1000))).toBe(true);
        expect(await enrol()).toBe(2);
        expect((await pendingRows()).map((row) => [row.subscriptionId, row.pickupDate, row.subscriptionStatus]).sort()).toEqual(
          [
            [atCutoff.signup.subscriptionId, WEEK, "cancelled"],
            [after.signup.subscriptionId, WEEK, "cancelled"],
          ].sort(),
        );
      });

      it("AC1: due is not about the card: an active subscription with none gets its row too", async () => {
        const ada = await subscriber({ card: false });
        expect(await enrol()).toBe(1);
        // The row stands in the way of a skip, so it is there.
        expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(false);
      });

      it("AC2: a subscription cancelled a moment before the week's cutoff gets no row", async () => {
        const ada = await subscriber();
        const due = await subscriber();
        expect(await repo.cancelSubscription(ada.signup.subscriptionId, new Date(cutoffInstant(product, WEEK).getTime() - 1))).toBe(true);
        expect(await enrol()).toBe(1);
        expect(await rowsOf(ada)).toEqual([]);
        expect((await rowsOf(due)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it("AC2: a subscription that skipped the week gets no row", async () => {
        const ada = await subscriber();
        const due = await subscriber();
        expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
        expect(await enrol()).toBe(1);
        expect(await rowsOf(ada)).toEqual([]);
        expect((await rowsOf(due)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it.each(["pending", "paid", "declined"] as const)("AC2: a subscription already holding a %s row for the week gets no second row, and its row is kept as it was", async (status) => {
        const ada = await subscriber();
        const due = await subscriber();
        const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, status, 4200);
        expect(await enrol()).toBe(1);
        const kept = status === "pending" ? [{ ledgerId, amountCents: 4200 }] : [];
        expect((await rowsOf(ada)).map((row) => ({ ledgerId: row.ledgerId, amountCents: row.amountCents }))).toEqual(kept);
        expect((await rowsOf(due)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it("AC2: a pending subscription gets no row, a stranded signup with a card on it included: only its own row stays", async () => {
        const stranded = await subscriber({ paid: false });
        const due = await subscriber();
        expect(await enrol()).toBe(1);
        expect((await rowsOf(stranded)).map((row) => row.ledgerId)).toEqual([stranded.signup.ledgerId]);
        expect((await rowsOf(due)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it("AC2: a subscription whose first paid week is after the week gets no row", async () => {
        await subscriber({ firstWeek: NEXT });
        const due = await subscriber();
        expect(await enrol()).toBe(1);
        expect((await pendingRows()).map((row) => row.subscriptionId)).toEqual([due.signup.subscriptionId]);
      });

      it("AC2: a closed week gets no rows at all: 0; the next week, open, still enrols", async () => {
        const ada = await subscriber();
        await close(WEEK);
        expect(await enrol()).toBe(0);
        expect(await pendingRows()).toEqual([]);
        expect(await enrol(NEXT)).toBe(1);
        expect((await rowsOf(ada)).map((row) => row.pickupDate)).toEqual([NEXT]);
      });

      it("AC2: a week closed and reopened is open again: its due subscriptions get their rows", async () => {
        const ada = await subscriber();
        await close(WEEK);
        await repo.reopenPickupWeek(product.id, WEEK);
        expect(await enrol()).toBe(1);
        expect((await rowsOf(ada)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it("AC10: a second enrolment of the week writes no second row: 0, and the first row is the one there", async () => {
        await subscriber();
        expect(await enrol()).toBe(1);
        const [first] = await pendingRows();
        expect(await enrol()).toBe(0);
        expect(await pendingRows()).toEqual([first]);
      });

      it("AC1: another product's subscriptions are its own enrolment, not this product's", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const ada = await subscriber();
        await subscriber({ on: crate });
        expect(await enrol()).toBe(1);
        expect((await pendingRows()).map((row) => row.subscriptionId)).toEqual([ada.signup.subscriptionId]);
        expect(await pendingRows(crate)).toEqual([]);
      });

      it("AC1: a product id that isn't a UUID enrols nothing: 0", async () => {
        await subscriber();
        expect(await repo.enrolWeek("not-a-uuid", WEEK, cutoffInstant(product, WEEK))).toBe(0);
        expect(await pendingRows()).toEqual([]);
        // The subscription was due: by the product's id it is enrolled.
        expect(await enrol()).toBe(1);
      });
    });

    describe("AC4, AC4a, AC5 — listPendingCharges", () => {
      it("AC4: a pending row is listed with its subscription, the member, their Square customer, the card, its amount and attempt, the subscription's created_at, its week open and its last pickup day the Monday after", async () => {
        const ada = await subscriber();
        const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 4200);
        const expected: PendingCharge = {
          ledgerId,
          subscriptionId: ada.signup.subscriptionId,
          subscriptionStatus: "active",
          memberId: ada.memberId,
          customerId: ada.customerId,
          cardId: ada.cardId ?? "no card",
          amountCents: 4200,
          attempt: 1,
          pickupDate: WEEK,
          createdAt: ada.signup.createdAt,
          closed: false,
          lastPickupDay: "2027-01-25",
        };
        expect(await pendingRows()).toEqual([expected]);
      });

      it("AC4: only pending rows are listed: paid, declined and skipped rows are not", async () => {
        const ada = await subscriber();
        const pending = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        await addLedgerRow(ada.signup.subscriptionId, NEXT, "paid", 5000);
        await addLedgerRow(ada.signup.subscriptionId, FEB_7, "declined", 5000);
        expect(await repo.skipWeek(ada.signup.subscriptionId, FEB_14)).toBe(true);
        expect((await pendingRows()).map((row) => row.ledgerId)).toEqual([pending]);
      });

      it("AC4: a pending row whose subscription has no card is not listed", async () => {
        const cardless = await subscriber({ card: false });
        await addLedgerRow(cardless.signup.subscriptionId, WEEK, "pending", 5000);
        const ada = await subscriber();
        const listed = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        expect((await pendingRows()).map((row) => row.ledgerId)).toEqual([listed]);
      });

      it("AC5: a stranded signup's row is listed, its subscription pending, with the card bound and the subscription's created_at", async () => {
        const stranded = await subscriber({ paid: false });
        expect(await pendingRows()).toEqual([
          expect.objectContaining({
            ledgerId: stranded.signup.ledgerId,
            subscriptionStatus: "pending",
            cardId: stranded.cardId,
            pickupDate: EARLIER,
            createdAt: stranded.signup.createdAt,
          }),
        ]);
      });

      it("AC4a: a cancelled subscription's pending row is listed, its subscription cancelled", async () => {
        const ada = await subscriber();
        const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        expect(await repo.cancelSubscription(ada.signup.subscriptionId, CLOSED_AT)).toBe(true);
        expect((await pendingRows()).map((row) => [row.ledgerId, row.subscriptionStatus])).toEqual([[ledgerId, "cancelled"]]);
      });

      it("AC4: oldest pickup date first, then the subscription's created_at", async () => {
        const ada = await subscriber();
        await tick();
        const grace = await subscriber();
        const adaNext = await addLedgerRow(ada.signup.subscriptionId, NEXT, "pending", 5000);
        const graceWeek = await addLedgerRow(grace.signup.subscriptionId, WEEK, "pending", 5000);
        const adaWeek = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        expect((await pendingRows()).map((row) => row.ledgerId)).toEqual([adaWeek, graceWeek, adaNext]);
      });

      // "The week is closed" has its edges here, through `closed`; enrolWeek and dropClosedWeekRow take one closed and
      // one open case each.
      it("AC4a: closed is true for a closed week and false for an open one, a moved week still open and a reopened week; a moved week's last pickup day is its moved one, closed or not", async () => {
        const ada = await subscriber();
        await repo.savePickupWeek(product.id, { weekOf: NEXT, closedAt: null, note: null, firstDay: "2027-01-30", lastDay: "2027-01-31" });
        await repo.savePickupWeek(product.id, { weekOf: FEB_21, closedAt: null, note: null, firstDay: "2027-02-20", lastDay: "2027-02-21" });
        const ids: Record<string, string> = {};
        for (const week of [WEEK, NEXT, FEB_7, FEB_14, FEB_21]) ids[week] = await addLedgerRow(ada.signup.subscriptionId, week, "pending", 5000);
        await close(WEEK);
        await close(FEB_7);
        await repo.reopenPickupWeek(product.id, FEB_7);
        await close(FEB_21);
        expect((await pendingRows()).map((row) => ({ ledgerId: row.ledgerId, closed: row.closed, lastPickupDay: row.lastPickupDay }))).toEqual([
          { ledgerId: ids[WEEK], closed: true, lastPickupDay: "2027-01-25" },
          { ledgerId: ids[NEXT], closed: false, lastPickupDay: "2027-01-31" },
          { ledgerId: ids[FEB_7], closed: false, lastPickupDay: "2027-02-08" },
          { ledgerId: ids[FEB_14], closed: false, lastPickupDay: "2027-02-15" },
          { ledgerId: ids[FEB_21], closed: true, lastPickupDay: "2027-02-21" },
        ]);
      });

      it("AC4: another product's rows are not listed, and a product id that isn't a UUID lists nothing", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const ada = await subscriber();
        const listed = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        const crateAda = await subscriber({ on: crate });
        const crateRow = await addLedgerRow(crateAda.signup.subscriptionId, WEEK, "pending", 5000);
        expect((await pendingRows()).map((row) => row.ledgerId)).toEqual([listed]);
        expect((await pendingRows(crate)).map((row) => row.ledgerId)).toEqual([crateRow]);
        expect(await repo.listPendingCharges("not-a-uuid")).toEqual([]);
      });
    });

    // The delete's repository conditions; its date condition, the week's pickup over, is the run's.
    describe("AC4a — dropClosedWeekRow", () => {
      it.each(["active", "cancelled"] as const)("AC4a: a pending row on an %s subscription in a closed week is deleted: true, and it is gone", async (status) => {
        const ada = await subscriber();
        const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        if (status === "cancelled") expect(await repo.cancelSubscription(ada.signup.subscriptionId, CLOSED_AT)).toBe(true);
        await close(WEEK);
        expect(await repo.dropClosedWeekRow(ledgerId)).toBe(true);
        expect(await rowsOf(ada)).toEqual([]);
        // No row is left in the way of a skip.
        expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
      });

      it("AC4a: a pending row in an open week is kept: false", async () => {
        const ada = await subscriber();
        const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        const closed = await subscriber();
        const closedRow = await addLedgerRow(closed.signup.subscriptionId, NEXT, "pending", 5000);
        await close(NEXT);
        expect(await repo.dropClosedWeekRow(ledgerId)).toBe(false);
        expect((await rowsOf(ada)).map((row) => row.ledgerId)).toEqual([ledgerId]);
        expect(await repo.dropClosedWeekRow(closedRow)).toBe(true);
      });

      it("AC4a: a paid row and a declined row in a closed week are kept: false", async () => {
        const ada = await subscriber();
        const paid = await addLedgerRow(ada.signup.subscriptionId, WEEK, "paid", 5000);
        const grace = await subscriber();
        const declined = await addLedgerRow(grace.signup.subscriptionId, WEEK, "declined", 5000);
        const other = await subscriber();
        const pending = await addLedgerRow(other.signup.subscriptionId, WEEK, "pending", 5000);
        await close(WEEK);
        expect(await repo.dropClosedWeekRow(paid)).toBe(false);
        expect(await repo.dropClosedWeekRow(declined)).toBe(false);
        expect(await repo.dropClosedWeekRow(pending)).toBe(true);
        expect((await repo.listMemberWeeks(ada.signup.subscriptionId)).paid.map((row) => row.weekOf).sort()).toEqual([EARLIER, WEEK]);
        expect(await repo.skipWeek(grace.signup.subscriptionId, WEEK)).toBe(false);
      });

      it("AC4a: a stranded signup's row, its subscription pending, in a closed week is kept: false", async () => {
        const stranded = await subscriber({ paid: false });
        const active = await subscriber({ firstWeek: "2027-01-10" });
        const activeRow = await addLedgerRow(active.signup.subscriptionId, EARLIER, "pending", 5000);
        await close(EARLIER);
        expect(await repo.dropClosedWeekRow(stranded.signup.ledgerId)).toBe(false);
        expect(await repo.dropClosedWeekRow(activeRow)).toBe(true);
        expect((await rowsOf(stranded)).map((row) => row.ledgerId)).toEqual([stranded.signup.ledgerId]);
      });

      it("AC4a: a second drop of the same row is false", async () => {
        const ada = await subscriber();
        const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        await close(WEEK);
        expect(await repo.dropClosedWeekRow(ledgerId)).toBe(true);
        expect(await repo.dropClosedWeekRow(ledgerId)).toBe(false);
      });

      it("AC4a: an unknown id and a string that isn't a UUID are false", async () => {
        const ada = await subscriber();
        const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        await close(WEEK);
        expect(await repo.dropClosedWeekRow(UNKNOWN_UUID)).toBe(false);
        expect(await repo.dropClosedWeekRow("not-a-uuid")).toBe(false);
        expect((await rowsOf(ada)).map((row) => row.ledgerId)).toEqual([ledgerId]);
      });
    });
  });
}
