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
import type { Card } from "../ports/payments.js";
import type { PendingCharge, PendingSignup, Repository } from "../ports/repository.js";
import type { ProductInput, ProductWithOptions } from "../products.js";
import { BOX, UNKNOWN_UUID, UUID } from "./contract-helpers.js";

type LedgerStatus = PendingSignup["ledgerStatus"];

export function runChargeRunContract(
  name: string,
  make: () => Promise<Repository>,
  addProduct: (input: ProductInput) => Promise<ProductWithOptions>,
  addLedgerRow: (subscriptionId: string, pickupDate: string, status: LedgerStatus, amountCents: number) => Promise<string>,
  /** Issue 194: marks the subscription comped, as `db:comp` sets `subscriptions.comped`. */
  markComped: (subscriptionId: string) => void | Promise<void>,
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
    /** When a stranded signup's charge was sent. */
    const SENT_AT = new Date("2027-01-05T15:00:02.000Z");

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

    /** The card Square saved, as the confirm is given it (issue 254): the id, with the brand and last four stored beside it. */
    const cardOf = (id: string): Card => ({ id, brand: "MASTERCARD", last4: "4444", expMonth: 1, expYear: 2029 });

    /**
     * A new member with a Square customer unless `customer` is false (issue 150), and their signup for `firstWeek` at
     * the first size and menu, charged at 5000 whatever `on` prices them at: paid (the subscription active), with a card on
     * file unless `card` is false; or, when `paid` is false, its charge out unless `card` is false.
     */
    const subscriber = async (
      { firstWeek = EARLIER, card = true, paid = true, customer = true, on = product }: { firstWeek?: string; card?: boolean; paid?: boolean; customer?: boolean; on?: ProductWithOptions } = {},
    ): Promise<Subscriber> => {
      const n = ++members;
      const memberId = (await repo.createMember({ email: `member-${n}@example.com` })).id;
      const customerId = `CUSTOMER_${n}`;
      if (customer) await repo.setMemberSquareCustomer(memberId, customerId);
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
      const cardId = card && paid ? `ccof:card-${n}` : null;
      if (paid) expect(await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, 5000, PAID_AT, cardId === null ? undefined : cardOf(cardId))).toBe("confirmed");
      else if (card) expect(await repo.startSignupCharge(signup.subscriptionId, SENT_AT)).toEqual({ amountCents: 5000, attempt: 1 });
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
        expect((await enrol()).pending).toBe(2);
        expect(await pendingRows()).toEqual([
          expect.objectContaining({ subscriptionId: ada.signup.subscriptionId, pickupDate: WEEK, amountCents: 5000, attempt: 1, ledgerId: expect.stringMatching(UUID) }),
          expect.objectContaining({ subscriptionId: grace.signup.subscriptionId, pickupDate: WEEK, amountCents: 5000, attempt: 1, ledgerId: expect.stringMatching(UUID) }),
        ]);
      });

      it("AC1 (DEC-033): the amount is the sum of the picks in effect for the week, not weekly_cents", async () => {
        const ada = await subscriber();
        expect(await repo.switchPicks(ada.signup.subscriptionId, choices(1, 1), WEEK, 4200)).toBe("switched");
        expect((await enrol()).pending).toBe(1);
        expect((await rowsOf(ada)).map((row) => row.amountCents)).toEqual([8000]);
      });

      it("AC1 (DEC-033): a set that starts after the week is not the week's: the earlier set is charged", async () => {
        const ada = await subscriber();
        expect(await repo.switchPicks(ada.signup.subscriptionId, choices(1, 0), NEXT, 8000)).toBe("switched");
        expect((await enrol()).pending).toBe(1);
        expect((await rowsOf(ada)).map((row) => row.amountCents)).toEqual([5000]);
      });

      it("AC1: a subscription cancelled at the week's cutoff instant is due, and so is one cancelled after it", async () => {
        const cutoff = cutoffInstant(product, WEEK);
        const atCutoff = await subscriber();
        const after = await subscriber();
        expect(await repo.cancelSubscription(atCutoff.signup.subscriptionId, cutoff)).toBe(true);
        expect(await repo.cancelSubscription(after.signup.subscriptionId, new Date(cutoff.getTime() + 60 * 60 * 1000))).toBe(true);
        expect((await enrol()).pending).toBe(2);
        expect((await pendingRows()).map((row) => [row.subscriptionId, row.pickupDate, row.subscriptionStatus]).sort()).toEqual(
          [
            [atCutoff.signup.subscriptionId, WEEK, "cancelled"],
            [after.signup.subscriptionId, WEEK, "cancelled"],
          ].sort(),
        );
      });

      it("AC1: due is not about the card: an active subscription with none gets its row too", async () => {
        const ada = await subscriber({ card: false });
        expect((await enrol()).pending).toBe(1);
        // The row stands in the way of a skip, so it is there.
        expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(false);
      });

      it("AC2: a subscription cancelled a moment before the week's cutoff gets no row", async () => {
        const ada = await subscriber();
        const due = await subscriber();
        expect(await repo.cancelSubscription(ada.signup.subscriptionId, new Date(cutoffInstant(product, WEEK).getTime() - 1))).toBe(true);
        expect((await enrol()).pending).toBe(1);
        expect(await rowsOf(ada)).toEqual([]);
        expect((await rowsOf(due)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it("AC2: a subscription that skipped the week gets no row", async () => {
        const ada = await subscriber();
        const due = await subscriber();
        expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
        expect((await enrol()).pending).toBe(1);
        expect(await rowsOf(ada)).toEqual([]);
        expect((await rowsOf(due)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it.each(["pending", "paid", "declined"] as const)("AC2: a subscription already holding a %s row for the week gets no second row, and its row is kept as it was", async (status) => {
        const ada = await subscriber();
        const due = await subscriber();
        const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, status, 4200);
        expect((await enrol()).pending).toBe(1);
        const kept = status === "pending" ? [{ ledgerId, amountCents: 4200 }] : [];
        expect((await rowsOf(ada)).map((row) => ({ ledgerId: row.ledgerId, amountCents: row.amountCents }))).toEqual(kept);
        expect((await rowsOf(due)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it("AC2: a pending subscription gets no row, a stranded signup with a card on it included: only its own row stays", async () => {
        const stranded = await subscriber({ paid: false });
        const due = await subscriber();
        expect((await enrol()).pending).toBe(1);
        expect((await rowsOf(stranded)).map((row) => row.ledgerId)).toEqual([stranded.signup.ledgerId]);
        expect((await rowsOf(due)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it("AC2: a subscription whose first paid week is after the week gets no row", async () => {
        await subscriber({ firstWeek: NEXT });
        const due = await subscriber();
        expect((await enrol()).pending).toBe(1);
        expect((await pendingRows()).map((row) => row.subscriptionId)).toEqual([due.signup.subscriptionId]);
      });

      it("AC2: a closed week gets no rows at all: 0; the next week, open, still enrols", async () => {
        const ada = await subscriber();
        await close(WEEK);
        expect((await enrol()).pending).toBe(0);
        expect(await pendingRows()).toEqual([]);
        expect((await enrol(NEXT)).pending).toBe(1);
        expect((await rowsOf(ada)).map((row) => row.pickupDate)).toEqual([NEXT]);
      });

      it("AC2: a week closed and reopened is open again: its due subscriptions get their rows", async () => {
        const ada = await subscriber();
        await close(WEEK);
        await repo.reopenPickupWeek(product.id, WEEK);
        expect((await enrol()).pending).toBe(1);
        expect((await rowsOf(ada)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it("AC10: a second enrolment of the week writes no second row: 0, and the first row is the one there", async () => {
        await subscriber();
        expect((await enrol()).pending).toBe(1);
        const [first] = await pendingRows();
        expect(await enrol()).toEqual({ pending: 0, zeroCents: 0, byWeekCredit: [], locked: [] });
        expect(await pendingRows()).toEqual([first]);
      });

      it("AC1: another product's subscriptions are its own enrolment, not this product's", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const ada = await subscriber();
        await subscriber({ on: crate });
        expect((await enrol()).pending).toBe(1);
        expect((await pendingRows()).map((row) => row.subscriptionId)).toEqual([ada.signup.subscriptionId]);
        expect(await pendingRows(crate)).toEqual([]);
      });

      it("AC1: a product id that isn't a UUID enrols nothing: 0", async () => {
        await subscriber();
        expect((await repo.enrolWeek("not-a-uuid", WEEK, cutoffInstant(product, WEEK))).pending).toBe(0);
        expect(await pendingRows()).toEqual([]);
        // The subscription was due: by the product's id it is enrolled.
        expect((await enrol()).pending).toBe(1);
      });
    });

    // Issue 150: a week credit is spent at enrolment, and a 0-cent set is paid there too: each row is written paid at 0
    // cents and never reaches the run's settle. The spend's edges are owned here (AC7); the run takes the receipts, the
    // report and one agreement with upcomingRows through it (src/charge-run.test.ts). paid_at, attempt and the payment
    // id are read by raw SQL, on Postgres alone (src/adapters/postgres-repository.test.ts).
    describe("issue 150 — enrolWeek spends a week credit, and pays a 0-cent set", () => {
      const JAN_10 = "2027-01-10";
      const DAY = 24 * 60 * 60 * 1000;
      /** BOX with its first size free: the first size and menu sum to 0 cents, the second size and first menu to 5000. */
      const SAMPLER: ProductInput = {
        ...BOX,
        name: "Sampler",
        optionTypes: BOX.optionTypes.map((type, i) => (i === 0 ? { ...type, options: type.options.map((option, j) => ({ ...option, priceCents: j === 0 ? 0 : 5000 })) } : type)),
      };
      const nothing = { pending: 0, zeroCents: 0, byWeekCredit: [], locked: [] };

      /** Issue 138: the set at `size` and `menu` of `on` as a read gives it: each type's name and its option's. */
      const meal = (size: number, menu: number, on: ProductWithOptions = product): { typeName: string; optionName: string }[] => {
        const [sizes, menus] = on.optionTypes;
        return [
          { typeName: sizes?.name ?? "no size type", optionName: sizes?.options[size]?.name ?? "no such size" },
          { typeName: menus?.name ?? "no menu type", optionName: menus?.options[menu]?.name ?? "no such menu" },
        ];
      };

      const paidOf = async (who: Subscriber) => [...(await repo.listMemberWeeks(who.signup.subscriptionId)).paid].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
      const unspentOf = async (who: Subscriber) => (await repo.listMemberWeeks(who.signup.subscriptionId)).weekCredits.map((credit) => credit.grantedForWeek).sort();
      const sortedIds = (ids: readonly string[]): string[] => [...ids].sort();
      const refundOwedOf = async (who: Subscriber) => (await repo.listSubscribers(product.id)).find((row) => row.subscriptionId === who.signup.subscriptionId)?.refundOwed;

      /** A subscriber whose signup week, EARLIER, closed after it was paid: one unspent week credit, at the first size and menu. */
      const holder = async (over: Parameters<typeof subscriber>[0] = {}): Promise<Subscriber> => {
        const who = await subscriber(over);
        await repo.closePickupWeek((over.on ?? product).id, EARLIER, "Kitchen flooded", CLOSED_AT);
        return who;
      };

      it("AC1: a subscription due the week holding an unspent week credit gets its row paid at 0 cents, read as paid by a week credit; enrolWeek hands it back with its member", async () => {
        const ada = await holder();
        expect(await enrol()).toEqual({ pending: 0, zeroCents: 0, byWeekCredit: [{ ledgerId: expect.stringMatching(UUID), memberId: ada.memberId }], locked: [] });
        expect(await paidOf(ada)).toEqual([
          { weekOf: EARLIER, amountCents: 5000, weekCredit: false, options: meal(0, 0) },
          { weekOf: WEEK, amountCents: 0, weekCredit: true, options: meal(0, 0) },
        ]);
      });

      it("AC1: the row a week credit paid is never pending: listPendingCharges does not list it, though its subscription has a card; another due subscription's row is", async () => {
        const ada = await holder();
        const due = await subscriber({ firstWeek: JAN_10 });
        await enrol();
        expect(await rowsOf(ada)).toEqual([]);
        expect((await pendingRows()).map((row) => row.subscriptionId)).toEqual([due.signup.subscriptionId]);
      });

      it("AC2: the week credit spent is the subscription's oldest by the week it was granted for, not by when it was granted; its spent_on is the row enrolWeek hands back, and the other stays unspent", async () => {
        const ada = await subscriber({ firstWeek: JAN_10 });
        await addLedgerRow(ada.signup.subscriptionId, EARLIER, "paid", 5000);
        // EARLIER's week credit is granted first, JAN_10's a day later.
        await repo.closePickupWeek(product.id, EARLIER, null, CLOSED_AT);
        await repo.closePickupWeek(product.id, JAN_10, null, new Date(CLOSED_AT.getTime() + DAY));
        const { byWeekCredit } = await enrol();
        expect(byWeekCredit).toHaveLength(1);
        expect((await repo.listWeekCredits(product.id, JAN_10)).map((credit) => credit.spentOn)).toEqual([byWeekCredit[0]?.ledgerId]);
        expect((await repo.listWeekCredits(product.id, EARLIER)).map((credit) => credit.spentOn)).toEqual([null]);
      });

      it("AC2: a second enrolment over the same state writes nothing and spends nothing: the subscription's next week credit stays unspent", async () => {
        const ada = await subscriber({ firstWeek: JAN_10 });
        await addLedgerRow(ada.signup.subscriptionId, EARLIER, "paid", 5000);
        await close(JAN_10);
        await close(EARLIER);
        expect((await enrol()).byWeekCredit).toHaveLength(1);
        expect(await enrol()).toEqual(nothing);
        expect(await unspentOf(ada)).toEqual([EARLIER]);
      });

      it("AC3: due is not about the card: a subscription with no card, and one whose member has no Square customer, each spend their week credit", async () => {
        const cardless = await subscriber({ card: false });
        const unlinked = await subscriber({ card: false, customer: false });
        await close(EARLIER);
        const { byWeekCredit } = await enrol();
        expect(byWeekCredit).toHaveLength(2);
        expect(byWeekCredit.map((row) => row.memberId).sort()).toEqual([cardless.memberId, unlinked.memberId].sort());
      });

      it("AC5: a subscription whose picks for the week sum to 0 cents, holding no week credit, gets its row paid at 0, counted in zeroCents, not pending, and read as no week credit's", async () => {
        const sampler = await addProduct(SAMPLER);
        const ada = await subscriber({ on: sampler });
        expect(await enrol(WEEK, sampler)).toEqual({ pending: 0, zeroCents: 1, byWeekCredit: [], locked: [] });
        expect(await pendingRows(sampler)).toEqual([]);
        expect(await paidOf(ada)).toEqual([
          { weekOf: EARLIER, amountCents: 5000, weekCredit: false, options: meal(0, 0, sampler) },
          { weekOf: WEEK, amountCents: 0, weekCredit: false, options: meal(0, 0, sampler) },
        ]);
      });

      it("AC5: a week credit comes first: a subscription holding one spends it though its picks sum to 0 cents, counted in byWeekCredit, not zeroCents", async () => {
        const sampler = await addProduct(SAMPLER);
        const ada = await holder({ on: sampler });
        expect(await enrol(WEEK, sampler)).toEqual({ pending: 0, zeroCents: 0, byWeekCredit: [{ ledgerId: expect.stringMatching(UUID), memberId: ada.memberId }], locked: [] });
        expect(await unspentOf(ada)).toEqual([]);
      });

      it("AC5: one enrolment counts each row it wrote once, in its own count: a charge in pending, a 0-cent set in zeroCents, a week credit in byWeekCredit", async () => {
        const sampler = await addProduct(SAMPLER);
        await subscriber({ firstWeek: JAN_10, on: sampler });
        const charged = await subscriber({ firstWeek: JAN_10, on: sampler });
        expect(await repo.switchPicks(charged.signup.subscriptionId, choices(1, 0, sampler), WEEK, 5000)).toBe("switched");
        const credited = await holder({ on: sampler });
        expect(await enrol(WEEK, sampler)).toEqual({ pending: 1, zeroCents: 1, byWeekCredit: [{ ledgerId: expect.stringMatching(UUID), memberId: credited.memberId }], locked: [] });
        expect((await pendingRows(sampler)).map((row) => [row.subscriptionId, row.amountCents])).toEqual([[charged.signup.subscriptionId, 5000]]);
      });

      it("AC6: the row's meal is the spent week credit's picks, not the set in effect for the week; the subscription's sets are untouched, so the next week is charged at them", async () => {
        const ada = await holder();
        expect(await repo.switchPicks(ada.signup.subscriptionId, choices(1, 1), WEEK, 8000)).toBe("switched");
        await enrol();
        expect((await paidOf(ada)).find((row) => row.weekOf === WEEK)).toEqual({ weekOf: WEEK, amountCents: 0, weekCredit: true, options: meal(0, 0) });
        expect(await repo.findSignupConfirmation(ada.memberId, product.id)).toMatchObject({ options: meal(1, 1), optionsFromWeek: WEEK, weeklyCents: 8000 });
        expect((await enrol(NEXT)).pending).toBe(1);
        expect((await rowsOf(ada)).map((row) => [row.pickupDate, row.amountCents])).toEqual([[NEXT, 8000]]);
      });

      it("AC7: a closed week spends no week credit: nothing is written, and the week credit waits", async () => {
        const ada = await holder();
        await close(WEEK);
        expect(await enrol()).toEqual(nothing);
        expect(await unspentOf(ada)).toEqual([EARLIER]);
      });

      it("AC7: a skipped week spends no week credit", async () => {
        const ada = await holder();
        expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
        expect(await enrol()).toEqual(nothing);
        expect(await unspentOf(ada)).toEqual([EARLIER]);
      });

      it.each(["pending", "paid", "declined"] as const)("AC7: a week already holding a %s row spends no week credit", async (status) => {
        const ada = await holder();
        await addLedgerRow(ada.signup.subscriptionId, WEEK, status, 4200);
        expect(await enrol()).toEqual(nothing);
        expect(await unspentOf(ada)).toEqual([EARLIER]);
      });

      it("AC7: a subscription cancelled a moment before the week's cutoff is not due: its week credit stays unspent, and a refund is owed", async () => {
        const ada = await holder();
        expect(await repo.cancelSubscription(ada.signup.subscriptionId, new Date(cutoffInstant(product, WEEK).getTime() - 1))).toBe(true);
        expect(await enrol()).toEqual(nothing);
        expect(await refundOwedOf(ada)).toBe(true);
      });

      it.each([
        ["at", 0],
        ["an hour after", 60 * 60 * 1000],
      ] as const)("AC9: a subscription cancelled %s the week's cutoff spends its week credit like an active one, and then owes no refund", async (_when, late) => {
        const ada = await holder();
        expect(await repo.cancelSubscription(ada.signup.subscriptionId, new Date(cutoffInstant(product, WEEK).getTime() + late))).toBe(true);
        expect(await enrol()).toEqual({ pending: 0, zeroCents: 0, byWeekCredit: [{ ledgerId: expect.stringMatching(UUID), memberId: ada.memberId }], locked: [] });
        expect(await refundOwedOf(ada)).toBe(false);
      });

      it("AC8: a week paid by a week credit that later closes grants a new week credit for its row, holding the spent week credit's picks, not the set in effect", async () => {
        const ada = await holder();
        expect(await repo.switchPicks(ada.signup.subscriptionId, choices(1, 1), WEEK, 8000)).toBe("switched");
        const { byWeekCredit } = await enrol();
        expect(byWeekCredit).toHaveLength(1);
        await close(WEEK);
        expect((await repo.listWeekCredits(product.id, WEEK)).map((credit) => ({ grantedFor: credit.grantedFor, spentOn: credit.spentOn, optionIds: sortedIds(credit.optionIds) }))).toEqual([
          { grantedFor: byWeekCredit[0]?.ledgerId, spentOn: null, optionIds: sortedIds(Object.values(choices(0, 0))) },
        ]);
        expect(await unspentOf(ada)).toEqual([WEEK]);
      });
    });

    // Issue 196: a subscription holding a declined row for an earlier week is locked: enrolWeek writes its week a
    // `locked` row at 0 cents, never charged. The lock's edges are owned here, as the due rule's are; listWeekDue and
    // listWeekBoxes take one locked and one unlocked case each (src/adapters/week-credit-contract.ts,
    // src/adapters/week-lists-contract.ts), and the run its report and email (src/charge-run.test.ts). The row's
    // columns are read by raw SQL, on Postgres alone (src/adapters/postgres-repository.test.ts).
    describe("issue 196 — enrolWeek locks a subscription holding a declined row", () => {
      const JAN_10 = "2027-01-10";
      const none = { pending: 0, zeroCents: 0, byWeekCredit: [], locked: [] };
      /** BOX with every option free: any picks sum to 0 cents. */
      const FREE: ProductInput = {
        ...BOX,
        name: "Free box",
        optionTypes: BOX.optionTypes.map((type) => ({ ...type, options: type.options.map((option) => ({ ...option, priceCents: 0 })) })),
      };

      /** A subscriber whose first paid week is January 10, holding a declined row for `declinedOn` (EARLIER unless given); with its id. */
      const declinedFor = async (declinedOn: string = EARLIER, over: Parameters<typeof subscriber>[0] = {}) => {
        const who = await subscriber({ firstWeek: JAN_10, ...over });
        return { ...who, declinedId: await addLedgerRow(who.signup.subscriptionId, declinedOn, "declined", 5000) };
      };

      const lockedOf = (who: Subscriber) => [{ ledgerId: expect.stringMatching(UUID), memberId: who.memberId }];
      const unspentOf = async (who: Subscriber) => (await repo.listMemberWeeks(who.signup.subscriptionId)).weekCredits.map((credit) => credit.grantedForWeek).sort();

      it("AC1: an active subscription due the week, holding a declined row for an earlier week, gets a row that is not pending: enrolWeek hands it back in locked with its member, in no other count; another due subscription is charged as before", async () => {
        const ada = await declinedFor();
        const grace = await subscriber({ firstWeek: JAN_10 });
        expect(await enrol()).toEqual({ pending: 1, zeroCents: 0, byWeekCredit: [], locked: lockedOf(ada) });
        expect(await rowsOf(ada)).toEqual([]);
        expect((await rowsOf(grace)).map((row) => row.pickupDate)).toEqual([WEEK]);
        // The locked row is there: it stands in the way of a skip.
        expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(false);
      });

      it("AC2: a declined row for the week itself locks nothing: the subscription already holds the week's row, so nothing is written", async () => {
        await declinedFor(WEEK);
        expect(await enrol()).toEqual(none);
      });

      it("AC2: a declined row for a later week locks nothing: the week is due and charged", async () => {
        const ada = await declinedFor(NEXT);
        expect(await enrol()).toEqual({ ...none, pending: 1 });
        expect((await rowsOf(ada)).map((row) => row.pickupDate)).toEqual([WEEK]);
      });

      it.each(["skipped", "paid"] as const)("AC1 [code]: a locked subscription already holding a %s row for the week is left as it is: no locked row", async (status) => {
        const ada = await declinedFor();
        if (status === "skipped") expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
        else await addLedgerRow(ada.signup.subscriptionId, WEEK, "paid", 0);
        expect(await enrol()).toEqual(none);
        expect((await repo.listMemberWeeks(ada.signup.subscriptionId)).skipped).toEqual(status === "skipped" ? [WEEK] : []);
      });

      it("AC1 [Lead] (DEC-032): a locked subscription holding an unspent week credit gets a locked row, and the week credit stays unspent", async () => {
        const ada = await declinedFor();
        await close(JAN_10);
        expect(await unspentOf(ada)).toEqual([JAN_10]);
        expect(await enrol()).toEqual({ ...none, locked: lockedOf(ada) });
        expect(await unspentOf(ada)).toEqual([JAN_10]);
      });

      it("AC1 [Lead]: the lock comes before the 0-cent rule: a locked subscription whose picks sum to 0 cents is counted in locked, not zeroCents", async () => {
        const free = await addProduct(FREE);
        const ada = await declinedFor(EARLIER, { on: free });
        expect(await enrol(WEEK, free)).toEqual({ ...none, locked: lockedOf(ada) });
        expect((await repo.listMemberWeeks(ada.signup.subscriptionId)).paid.map((row) => row.weekOf)).toEqual([JAN_10]);
      });

      it.each([
        ["at", 0],
        ["an hour after", 60 * 60 * 1000],
      ] as const)("AC1 [Lead], AC5: only an active subscription is locked: one cancelled %s the week's cutoff, holding an earlier declined row, gets neither a pending nor a locked row", async (_when, late) => {
        const ada = await declinedFor();
        expect(await repo.cancelSubscription(ada.signup.subscriptionId, new Date(cutoffInstant(product, WEEK).getTime() + late))).toBe(true);
        expect(await enrol()).toEqual(none);
        // No row stands in the way of a skip.
        expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
      });

      it("AC6: a closed week gets no locked row; the next week, open, does", async () => {
        const ada = await declinedFor();
        await close(WEEK);
        expect(await enrol()).toEqual(none);
        expect(await enrol(NEXT)).toEqual({ ...none, locked: lockedOf(ada) });
      });

      it("AC1: a second enrolment over the same state writes no second locked row", async () => {
        const ada = await declinedFor();
        expect(await enrol()).toEqual({ ...none, locked: lockedOf(ada) });
        expect(await enrol()).toEqual(none);
      });

      it("AC5: the lock holds week after week until the declined row is paid; then the next week is due and charged, and the locked rows are never charged", async () => {
        const ada = await declinedFor();
        expect(await enrol()).toEqual({ ...none, locked: lockedOf(ada) });
        expect(await enrol(NEXT)).toEqual({ ...none, locked: lockedOf(ada) });
        expect(await repo.confirmSignupRows(ada.declinedId, `PAYMENT_${ada.declinedId}`, 5000, CLOSED_AT)).toBe("confirmed");
        expect(await enrol(FEB_7)).toEqual({ ...none, pending: 1 });
        expect((await rowsOf(ada)).map((row) => row.pickupDate)).toEqual([FEB_7]);
      });

      it("AC20 (issue 254): a declined row with a card update's charge out locks the next week as any declined row does", async () => {
        const ada = await declinedFor();
        expect(await repo.claimCardUpdate(ada.signup.subscriptionId, CLOSED_AT)).toMatchObject({ kind: "claimed" });
        expect(await enrol()).toEqual({ ...none, locked: lockedOf(ada) });
        expect(await repo.findMemberSubscription(ada.memberId, product.id)).toMatchObject({ declinedWeek: EARLIER });
      });

      // AC8: the account home reads the declined week from the subscription; which row it is, is owned here.
      it("AC8: findMemberSubscription's declinedWeek is the earliest declined row's pickup date, whatever order the rows were written in", async () => {
        const ada = await declinedFor(NEXT);
        await addLedgerRow(ada.signup.subscriptionId, EARLIER, "declined", 5000);
        expect(await repo.findMemberSubscription(ada.memberId, product.id)).toMatchObject({ declinedWeek: EARLIER });
      });

      it("AC8: with no declined row, its rows paid, pending and skipped, declinedWeek is null", async () => {
        const ada = await subscriber({ firstWeek: JAN_10 });
        await addLedgerRow(ada.signup.subscriptionId, EARLIER, "paid", 5000);
        await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        expect(await repo.skipWeek(ada.signup.subscriptionId, NEXT)).toBe(true);
        expect(await repo.findMemberSubscription(ada.memberId, product.id)).toMatchObject({ declinedWeek: null });
      });
    });

    // Issue 194: a comped subscription is a third reason enrolWeek writes a row paid at 0 cents, beside a week credit and
    // a free pick; a week credit still comes first, and a skip still stands. The comp's edges are owned here; the run takes
    // no charge and no email for it, and a week credit's receipt, through src/charge-run.test.ts. The row's paid_at is
    // read by raw SQL, on Postgres alone (src/adapters/postgres-repository.test.ts). Its picks here cost 5000, so only the
    // comp can make the row 0 cents.
    describe("issue 194 — enrolWeek pays a comped subscription's week at 0 cents", () => {
      const none = { pending: 0, zeroCents: 0, byWeekCredit: [], locked: [] };
      const weeksOf = (who: Subscriber) => repo.listMemberWeeks(who.signup.subscriptionId);

      /** A subscriber, its first week EARLIER paid at signup, its subscription then marked comped. */
      const comped = async (): Promise<Subscriber> => {
        const who = await subscriber();
        await markComped(who.signup.subscriptionId);
        return who;
      };

      it("AC1: a comped active subscription due the week gets its row paid at 0 cents, counted in zeroCents and not pending; a subscription not comped is charged at its picks", async () => {
        const ada = await comped();
        const grace = await subscriber();
        expect(await enrol()).toEqual({ ...none, pending: 1, zeroCents: 1 });
        expect(await rowsOf(ada)).toEqual([]);
        expect((await rowsOf(grace)).map((row) => [row.pickupDate, row.amountCents])).toEqual([[WEEK, 5000]]);
        expect((await weeksOf(ada)).paid.map((row) => [row.weekOf, row.amountCents, row.weekCredit]).sort()).toEqual([
          [EARLIER, 5000, false],
          [WEEK, 0, false],
        ]);
      });

      it("AC3: a comped subscription that skipped the week keeps it skipped: nothing is written", async () => {
        const ada = await comped();
        expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
        expect(await enrol()).toEqual(none);
        expect((await weeksOf(ada)).skipped).toEqual([WEEK]);
        expect((await weeksOf(ada)).paid.map((row) => row.weekOf)).toEqual([EARLIER]);
      });

      it("AC4: a comped subscription holding an unspent week credit spends it on the week as any member would: counted in byWeekCredit, not zeroCents", async () => {
        const ada = await comped();
        await close(EARLIER);
        expect(await enrol()).toEqual({ ...none, byWeekCredit: [{ ledgerId: expect.stringMatching(UUID), memberId: ada.memberId }] });
        expect((await weeksOf(ada)).weekCredits).toEqual([]);
        expect((await weeksOf(ada)).paid.find((row) => row.weekOf === WEEK)).toMatchObject({ amountCents: 0, weekCredit: true });
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
          chargeSentAt: null,
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

      it("AC4: a pending row with no card and no charge out whose subscription is not active is not listed: a pending signup's, and a cancelled subscription's", async () => {
        await subscriber({ card: false, paid: false });
        const cardless = await subscriber({ card: false });
        await addLedgerRow(cardless.signup.subscriptionId, WEEK, "pending", 5000);
        expect(await repo.cancelSubscription(cardless.signup.subscriptionId, CLOSED_AT)).toBe(true);
        const ada = await subscriber();
        const listed = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        expect((await pendingRows()).map((row) => row.ledgerId)).toEqual([listed]);
      });

      it("AC15 (issue 254): an active subscription's pending row with no card and no charge out is listed, with neither", async () => {
        const cardless = await subscriber({ card: false });
        const ledgerId = await addLedgerRow(cardless.signup.subscriptionId, WEEK, "pending", 5000);
        expect((await pendingRows()).map((row) => [row.ledgerId, row.subscriptionStatus, row.cardId, row.chargeSentAt])).toEqual([[ledgerId, "active", null, null]]);
      });

      it("AC15 (issue 254): an active subscription's pending row with no card whose member has no Square customer is not listed", async () => {
        const unlinked = await subscriber({ card: false, customer: false });
        await addLedgerRow(unlinked.signup.subscriptionId, WEEK, "pending", 5000);
        const cardless = await subscriber({ card: false });
        const listed = await addLedgerRow(cardless.signup.subscriptionId, WEEK, "pending", 5000);
        expect((await pendingRows()).map((row) => row.ledgerId)).toEqual([listed]);
      });

      it("AC5: a stranded signup's row is listed, its subscription pending, with its charge out, no card, and the subscription's created_at", async () => {
        const stranded = await subscriber({ paid: false });
        expect(await pendingRows()).toEqual([
          expect.objectContaining({
            ledgerId: stranded.signup.ledgerId,
            subscriptionStatus: "pending",
            cardId: null,
            chargeSentAt: SENT_AT,
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

    // Issue 135: the flag the admin's list and member page show. Its rule is owned here; the three screens take one
    // shown and one not-shown row through it. A declined row retried to paid is task 2.13's.
    describe("AC4 (issue 135) — listSubscribers' cardDeclined", () => {
      const cardDeclinedOf = async (who: Subscriber) =>
        (await repo.listSubscribers(product.id)).find((row) => row.subscriptionId === who.signup.subscriptionId)?.cardDeclined;

      it("AC4: an active subscription holding a declined ledger row is cardDeclined", async () => {
        const ada = await subscriber();
        await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
        expect(await cardDeclinedOf(ada)).toBe(true);
      });

      it("AC20 (issue 254): while a card update's charge is out on its declined row, an active subscription is still cardDeclined", async () => {
        const ada = await subscriber();
        await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
        expect(await repo.claimCardUpdate(ada.signup.subscriptionId, CLOSED_AT)).toMatchObject({ kind: "claimed" });
        expect(await cardDeclinedOf(ada)).toBe(true);
      });

      it("AC4: a cancelled subscription holding a declined ledger row is not", async () => {
        const ada = await subscriber();
        await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
        expect(await repo.cancelSubscription(ada.signup.subscriptionId, CLOSED_AT)).toBe(true);
        expect(await cardDeclinedOf(ada)).toBe(false);
      });

      it("AC4: an active subscription with no declined row, its rows paid, pending and skipped, is not", async () => {
        const ada = await subscriber();
        await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        await addLedgerRow(ada.signup.subscriptionId, NEXT, "paid", 5000);
        expect(await repo.skipWeek(ada.signup.subscriptionId, FEB_7)).toBe(true);
        expect(await cardDeclinedOf(ada)).toBe(false);
      });
    });

    // Issue 135 review: the run emails a decline only when its own write turned the row declined, so the write says
    // whether it did, as confirmSignupRows says "confirmed".
    describe("AC3 (review) (issue 135) — recordSignupDecline says whether it turned the row declined", () => {
      it("AC3 (review): recordSignupDecline is true on a pending row, which is then no longer pending, and false on the same row called again", async () => {
        const ada = await subscriber();
        const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
        expect(await repo.recordSignupDecline(ledgerId)).toBe(true);
        expect(await rowsOf(ada)).toEqual([]);
        expect(await repo.recordSignupDecline(ledgerId)).toBe(false);
      });

      it("AC3 (review): recordSignupDecline is false on a paid row, and the row stays paid", async () => {
        const ada = await subscriber();
        const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "paid", 5000);
        expect(await repo.recordSignupDecline(ledgerId)).toBe(false);
        expect((await repo.listMemberWeeks(ada.signup.subscriptionId)).paid.map((row) => row.weekOf).sort()).toEqual([EARLIER, WEEK]);
      });
    });

    // Issue 145: the repository's part of a card update. Which rows are declined, whether a declined row's week is
    // closed, which paid row a page may name, which row the card page reads, and what the claim decides and
    // writes are owned here: claimCardUpdate's `out`, `busy`, `inactive` and a closed week's declined row (AC10, AC13) have
    // their edges here, and src/update-card.test.ts and the pages take one case each through it.
    describe("issue 145 — a card update's repository methods", () => {
      const NEW_CARD: Card = { id: "ccof:new-card", brand: "VISA", last4: "1111", expMonth: 12, expYear: 2030 };
      const OLD_ON_FILE = { brand: "MASTERCARD", last4: "4444" };
      const NEW_ON_FILE = { brand: "VISA", last4: "1111" };

      const declinedOf = (who: Subscriber) => repo.listDeclinedCharges(who.signup.subscriptionId);
      const onFile = (who: Subscriber) => repo.findSubscriptionCard(who.signup.subscriptionId);
      /** When a claim's charge is sent, and a later claim's. */
      const CLAIMED_AT = new Date("2027-01-21T15:00:00.000Z");
      const LATER_AT = new Date("2027-01-21T15:20:00.000Z");
      const claim = (who: Subscriber, now: Date = CLAIMED_AT) => repo.claimCardUpdate(who.signup.subscriptionId, now);
      const replace = (who: Subscriber, card: Card = NEW_CARD) => repo.replaceSubscriptionCard(who.signup.subscriptionId, card);
      /** The row a claim of `who`'s `ledgerId` hands back: as listPendingCharges lists it, the old card on file, its charge out since the claim, at attempt 2. */
      const claimedRow = (who: Subscriber, ledgerId: string, pickupDate: string, amountCents: number, lastPickupDay: string): PendingCharge => ({
        ledgerId,
        subscriptionId: who.signup.subscriptionId,
        subscriptionStatus: "active",
        memberId: who.memberId,
        customerId: who.customerId,
        cardId: who.cardId,
        chargeSentAt: CLAIMED_AT,
        amountCents,
        attempt: 2,
        pickupDate,
        createdAt: who.signup.createdAt,
        closed: false,
        lastPickupDay,
      });

      describe("the card's brand and last four", () => {
        it("AC2: the confirm stores the card's brand and last four beside its id; findSubscriptionCard reads them", async () => {
          const ada = await subscriber();
          expect(await repo.findSubscriptionCard(ada.signup.subscriptionId)).toEqual({ brand: "MASTERCARD", last4: "4444" });
        });

        it("AC2: a subscription with no card stored reads null; guards the case above", async () => {
          const ada = await subscriber({ card: false });
          expect(await repo.findSubscriptionCard(ada.signup.subscriptionId)).toBeNull();
        });
      });

      describe("claimCardUpdate", () => {
        it("AC5, AC12, AC9 (issue 254): on an active subscription holding an open week's declined row it is claimed: the row stays declined at attempt + 1 with its charge out since the moment given, handed back as listPendingCharges lists it, and the old card stays on file", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 4200);
          const expected = claimedRow(ada, ledgerId, WEEK, 4200, "2027-01-25");
          expect(await claim(ada)).toEqual({ kind: "claimed", charge: expected });
          expect(await rowsOf(ada)).toEqual([expected]);
          expect(await declinedOf(ada)).toEqual([{ ledgerId, pickupDate: WEEK, amountCents: 4200, attempt: 2, closed: false }]);
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
        });

        it("AC9 (issue 254): a subscription with no card on file is claimed the same way, its row out with no card; findPendingCharge reads it", async () => {
          const ada = await subscriber({ card: false });
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const expected = claimedRow(ada, ledgerId, WEEK, 5000, "2027-01-25");
          expect(await claim(ada)).toEqual({ kind: "claimed", charge: expected });
          expect(expected.cardId).toBeNull();
          expect(await repo.findPendingCharge(ada.signup.subscriptionId)).toEqual(expected);
          expect(await onFile(ada)).toBeNull();
        });

        it("AC5: with two open weeks' declined rows, the oldest week's is claimed and the other stays declined at its attempt", async () => {
          const ada = await subscriber();
          const next = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 5000);
          const week = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect(await claim(ada)).toEqual({ kind: "claimed", charge: claimedRow(ada, week, WEEK, 5000, "2027-01-25") });
          expect(await declinedOf(ada)).toEqual([
            { ledgerId: week, pickupDate: WEEK, amountCents: 5000, attempt: 2, closed: false },
            { ledgerId: next, pickupDate: NEXT, amountCents: 5000, attempt: 1, closed: false },
          ]);
        });

        it("AC20 (issue 254): with two open weeks' declined rows, a second claim while the first's charge is out is out: it hands back the first and does not claim the other", async () => {
          const ada = await subscriber();
          const next = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 5000);
          const week = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          expect(await claim(ada, LATER_AT)).toEqual({ kind: "out", charge: claimedRow(ada, week, WEEK, 5000, "2027-01-25") });
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([
            [week, 2],
            [next, 1],
          ]);
        });

        it("AC5: a locked row is not pending: a subscription locked by its declined row is claimed, not busy", async () => {
          const ada = await subscriber({ firstWeek: "2027-01-10" });
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, EARLIER, "declined", 5000);
          expect((await enrol()).locked).toHaveLength(1);
          expect(await claim(ada)).toEqual({ kind: "claimed", charge: claimedRow(ada, ledgerId, EARLIER, 5000, "2027-01-18") });
        });

        it("AC12, AC20 (issue 254): a second claim while the claimed row's charge is out is out, with that row: it stays declined, and keeps its attempt and its moment", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          expect(await claim(ada, LATER_AT)).toEqual({ kind: "out", charge: claimedRow(ada, ledgerId, WEEK, 5000, "2027-01-25") });
          expect(await rowsOf(ada)).toEqual([claimedRow(ada, ledgerId, WEEK, 5000, "2027-01-25")]);
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[ledgerId, 2]]);
        });

        it("AC12, AC20 (issue 254): a claimed row whose week then closes is still out: a second claim is out with it, not nothing_owed", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          await close(WEEK);
          expect(await claim(ada, LATER_AT)).toEqual({ kind: "out", charge: { ...claimedRow(ada, ledgerId, WEEK, 5000, "2027-01-25"), closed: true } });
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[ledgerId, 2]]);
        });

        it("AC10: with a card on file any pending row is busy, a charge-run row with nothing to do with the declined one included: the card stays, the declined row stays declined at its attempt, and a closed week's declined row is not deleted", async () => {
          const ada = await subscriber();
          const pending = await addLedgerRow(ada.signup.subscriptionId, NEXT, "pending", 5000);
          const open = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const closed = await addLedgerRow(ada.signup.subscriptionId, FEB_7, "declined", 5000);
          await close(FEB_7);
          expect(await claim(ada)).toEqual({ kind: "busy" });
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([
            [open, 1],
            [closed, 1],
          ]);
          expect((await rowsOf(ada)).map((row) => [row.ledgerId, row.cardId, row.attempt])).toEqual([[pending, ada.cardId, 1]]);
        });

        it("AC12 (issue 254): a charge out comes before the weekly run's pending row on a subscription with a card: out, not busy, with the row whose charge is out, whichever week is earlier", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          const pending = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
          expect(await claim(ada, LATER_AT)).toEqual({ kind: "out", charge: claimedRow(ada, ledgerId, NEXT, 5000, "2027-02-01") });
          expect((await rowsOf(ada)).map((row) => [row.ledgerId, row.attempt, row.chargeSentAt])).toEqual([
            [pending, 1, null],
            [ledgerId, 2, CLAIMED_AT],
          ]);
        });

        it("AC12 (issue 254): on a cancelled subscription a claim is inactive, before out: the row keeps its attempt and its moment", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          expect(await repo.cancelSubscription(ada.signup.subscriptionId, CLOSED_AT)).toBe(true);
          expect(await claim(ada, LATER_AT)).toEqual({ kind: "inactive" });
          expect((await rowsOf(ada)).map((row) => [row.ledgerId, row.attempt, row.chargeSentAt])).toEqual([[ledgerId, 2, CLAIMED_AT]]);
        });

        // The run charges that row on whatever card is on file, so with none a save must not be refused for it.
        it.each(["open", "closed"] as const)("AC20 (issue 254): with no card on file, a pending row with no charge out, its week %s, is not busy: nothing is owed, and the row stays pending at its attempt", async (week) => {
          const ada = await subscriber({ card: false });
          const pending = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
          if (week === "closed") await close(WEEK);
          expect(await claim(ada)).toEqual({ kind: "nothing_owed" });
          expect((await rowsOf(ada)).map((row) => [row.ledgerId, row.attempt, row.chargeSentAt])).toEqual([[pending, 1, null]]);
        });

        it("AC20 (issue 254): with no card on file, an open week's declined row is claimed beside an earlier week's pending row with no charge out, which stays pending at its attempt", async () => {
          const ada = await subscriber({ card: false });
          const pending = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
          const declined = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 5000);
          expect(await claim(ada)).toEqual({ kind: "claimed", charge: claimedRow(ada, declined, NEXT, 5000, "2027-02-01") });
          expect((await rowsOf(ada)).map((row) => [row.ledgerId, row.attempt, row.chargeSentAt])).toEqual([
            [pending, 1, null],
            [declined, 2, CLAIMED_AT],
          ]);
        });

        it("AC20 (issue 254): with no card on file, a row with its charge out is out still: it stays declined at its attempt, with its moment", async () => {
          const ada = await subscriber({ card: false });
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          expect(await claim(ada, LATER_AT)).toEqual({ kind: "out", charge: claimedRow(ada, ledgerId, WEEK, 5000, "2027-01-25") });
          expect(await rowsOf(ada)).toEqual([claimedRow(ada, ledgerId, WEEK, 5000, "2027-01-25")]);
        });

        it("AC3: with no declined row nothing is owed, and replaceSubscriptionCard then replaces: the new card is on file, and listPendingCharges gives the new card's id", async () => {
          const ada = await subscriber();
          expect(await claim(ada)).toEqual({ kind: "nothing_owed" });
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
          expect(await replace(ada)).toBe("replaced");
          expect(await onFile(ada)).toEqual(NEW_ON_FILE);
          await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
          expect((await rowsOf(ada)).map((row) => row.cardId)).toEqual([NEW_CARD.id]);
        });

        it("AC3: it is that subscription's alone: another member's card and declined row stay", async () => {
          const ada = await subscriber();
          const grace = await subscriber();
          const gracesRow = await addLedgerRow(grace.signup.subscriptionId, WEEK, "declined", 5000);
          expect(await claim(ada)).toEqual({ kind: "nothing_owed" });
          expect(await replace(ada)).toBe("replaced");
          expect(await onFile(grace)).toEqual(OLD_ON_FILE);
          expect((await declinedOf(grace)).map((row) => [row.ledgerId, row.attempt])).toEqual([[gracesRow, 1]]);
        });

        it.each([
          ["cancelled", { paid: true }, true, false],
          ["pending", { paid: false }, false, false],
          ["cancelled, holding a pending row,", { paid: true }, true, true],
        ] as const)("AC5: on a %s subscription it is inactive, before busy: the card on file stays as it was and its declined row stays declined at its attempt", async (_status, over, cancel, pendingRow) => {
          const ada = await subscriber(over);
          const declined = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const before = await onFile(ada);
          expect(before).toEqual(over.paid ? OLD_ON_FILE : null);
          if (pendingRow) await addLedgerRow(ada.signup.subscriptionId, NEXT, "pending", 5000);
          if (cancel) expect(await repo.cancelSubscription(ada.signup.subscriptionId, CLOSED_AT)).toBe(true);
          expect(await claim(ada)).toEqual({ kind: "inactive" });
          expect(await onFile(ada)).toEqual(before);
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[declined, 1]]);
        });

        it("AC5: a claim that its withActor rolls back writes nothing: the old card stays, and the row stays declined at its attempt", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const failure = new Error("fn failed after the claim");
          await expect(
            repo.withActor({ member: ada.memberId }, async (r) => {
              expect((await r.claimCardUpdate(ada.signup.subscriptionId, CLAIMED_AT)).kind).toBe("claimed");
              throw failure;
            }),
          ).rejects.toBe(failure);
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[ledgerId, 1]]);
          expect(await rowsOf(ada)).toEqual([]);
        });

        it("AC13: it claims the open week's declined row and deletes nothing; a confirm with a card then deletes the subscription's declined rows whose week is closed; a closed week's paid row and another member's declined row stay", async () => {
          const ada = await subscriber();
          const grace = await subscriber();
          const closed = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const closedNext = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 5000);
          const open = await addLedgerRow(ada.signup.subscriptionId, FEB_7, "declined", 5000);
          const gracesRow = await addLedgerRow(grace.signup.subscriptionId, WEEK, "declined", 5000);
          await close(WEEK);
          await close(NEXT);
          await close(EARLIER);
          expect(await claim(ada)).toEqual({ kind: "claimed", charge: claimedRow(ada, open, FEB_7, 5000, "2027-02-08") });
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([closed, closedNext, open]);
          expect((await rowsOf(ada)).map((row) => row.ledgerId)).toEqual([open]);
          expect(await repo.confirmSignupRows(open, "PAYMENT_OPEN", 5000, PAID_AT, NEW_CARD)).toBe("confirmed");
          expect(await onFile(ada)).toEqual(NEW_ON_FILE);
          expect(await declinedOf(ada)).toEqual([]);
          expect((await declinedOf(grace)).map((row) => row.ledgerId)).toEqual([gracesRow]);
          expect((await repo.listMemberWeeks(ada.signup.subscriptionId)).paid.map((row) => row.weekOf).sort()).toEqual([EARLIER, FEB_7]);
        });

        it("AC13: with no closed week's declined row a confirm with a card deletes nothing: the open declined row is paid, and another open one stays declined", async () => {
          const ada = await subscriber();
          const open = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const later = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          expect((await rowsOf(ada)).map((row) => row.ledgerId)).toEqual([open]);
          expect(await repo.confirmSignupRows(open, "PAYMENT_OPEN", 5000, PAID_AT, NEW_CARD)).toBe("confirmed");
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([later]);
          expect((await repo.listMemberWeeks(ada.signup.subscriptionId)).paid.map((row) => row.weekOf).sort()).toEqual([EARLIER, WEEK]);
        });

        it("AC10 (issue 254): a confirm of a claimed row with no card takes the old card off file, its id included, and leaves the closed weeks' declined rows", async () => {
          const ada = await subscriber();
          const open = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const closed = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 5000);
          await close(NEXT);
          expect((await claim(ada)).kind).toBe("claimed");
          expect(await repo.confirmSignupRows(open, "PAYMENT_OPEN", 5000, PAID_AT)).toBe("confirmed");
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([closed]);
          expect(await onFile(ada)).toBeNull();
          expect(await repo.findMemberSubscription(ada.memberId, product.id)).toMatchObject({ needsCard: true });
          await addLedgerRow(ada.signup.subscriptionId, FEB_7, "pending", 5000);
          expect((await rowsOf(ada)).map((row) => row.cardId)).toEqual([null]);
        });

        it.each(["pending", "declined"] as const)("AC10 (issue 254): a confirm with no card of a %s row with no charge out, as the charge run's is, leaves the card on file", async (status) => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, status, 5000);
          expect(await repo.confirmSignupRows(ledgerId, "PAYMENT_RUN", 5000, PAID_AT)).toBe("confirmed");
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
        });

        it("AC10 (issue 254): a mismatch on a claimed row with no card leaves it declined with its charge out and the old card on file; once paid, an already leaves the new one", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const expected = claimedRow(ada, ledgerId, WEEK, 5000, "2027-01-25");
          expect((await claim(ada)).kind).toBe("claimed");
          expect(await repo.confirmSignupRows(ledgerId, "PAYMENT_OTHER", 4200, PAID_AT)).toBe("mismatch");
          expect(await rowsOf(ada)).toEqual([expected]);
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[ledgerId, 2]]);
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
          expect(await repo.confirmSignupRows(ledgerId, "PAYMENT_OPEN", 5000, PAID_AT, NEW_CARD)).toBe("confirmed");
          expect(await repo.confirmSignupRows(ledgerId, "PAYMENT_OPEN", 5000, PAID_AT)).toBe("already");
          expect(await onFile(ada)).toEqual(NEW_ON_FILE);
        });

        it("AC13 (issue 254): a card going on file deletes a closed week's declined row only when no charge is out on it", async () => {
          const ada = await subscriber();
          const out = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const closed = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 5000);
          const other = await addLedgerRow(ada.signup.subscriptionId, FEB_7, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          await close(WEEK);
          await close(NEXT);
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.closed])).toEqual([
            [out, true],
            [closed, true],
            [other, false],
          ]);
          expect(await repo.confirmSignupRows(other, "PAYMENT_OTHER", 5000, PAID_AT, NEW_CARD)).toBe("confirmed");
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([out]);
          expect((await rowsOf(ada)).map((row) => [row.ledgerId, row.chargeSentAt])).toEqual([[out, CLAIMED_AT]]);
        });

        it("AC13: when every declined row is a closed week's, the claim is nothing_owed and deletes nothing; replaceSubscriptionCard deletes them: nothing turns pending, and the new card is on file", async () => {
          const ada = await subscriber();
          const closed = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          await close(WEEK);
          expect(await claim(ada)).toEqual({ kind: "nothing_owed" });
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([closed]);
          expect(await replace(ada)).toBe("replaced");
          expect(await declinedOf(ada)).toEqual([]);
          expect(await rowsOf(ada)).toEqual([]);
          expect(await onFile(ada)).toEqual(NEW_ON_FILE);
        });

        it("AC11 (issue 254): a decline of a claimed row, declined with its charge out, is true and leaves it declined at its new attempt with no charge out, and false called again; a later claim bumps it again, and the old card stays", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[ledgerId, 2]]);
          expect(await repo.recordSignupDecline(ledgerId)).toBe(true);
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[ledgerId, 2]]);
          expect(await rowsOf(ada)).toEqual([]);
          expect(await repo.recordSignupDecline(ledgerId)).toBe(false);
          expect(await repo.abandonCharge(ledgerId, CLAIMED_AT)).toBeNull();
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
          expect((await claim(ada, LATER_AT)).kind).toBe("claimed");
          expect((await rowsOf(ada)).map((row) => [row.attempt, row.chargeSentAt])).toEqual([[3, LATER_AT]]);
        });
      });

      // The nothing-owed save: the claim's refusals, checked again under the same lock, and the one other write that deletes
      // closed weeks' declined rows.
      describe("replaceSubscriptionCard (issue 254)", () => {
        it("AC13: a subscription with an open week's declined row is replaced too: the row the run declined meanwhile stays declined at its attempt", async () => {
          const ada = await subscriber();
          const open = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const closed = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 5000);
          await close(NEXT);
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([open, closed]);
          expect(await replace(ada)).toBe("replaced");
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[open, 1]]);
          expect(await onFile(ada)).toEqual(NEW_ON_FILE);
        });

        it("AC13: a subscription with no card on file gets one", async () => {
          const ada = await subscriber({ card: false });
          expect(await replace(ada)).toBe("replaced");
          expect(await onFile(ada)).toEqual(NEW_ON_FILE);
        });

        it("AC13: with a card on file any pending row is busy: the card and a closed week's declined row stay", async () => {
          const ada = await subscriber();
          const closed = await addLedgerRow(ada.signup.subscriptionId, FEB_7, "declined", 5000);
          await close(FEB_7);
          await addLedgerRow(ada.signup.subscriptionId, NEXT, "pending", 5000);
          expect(await replace(ada)).toBe("busy");
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([closed]);
        });

        it.each(["open", "closed"] as const)("AC20 (issue 254): with no card on file, a pending row with no charge out, its week %s, is not busy: replaced, and the row, still pending at its attempt, has the new card", async (week) => {
          const ada = await subscriber({ card: false });
          const pending = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
          if (week === "closed") await close(WEEK);
          expect(await replace(ada)).toBe("replaced");
          expect(await onFile(ada)).toEqual(NEW_ON_FILE);
          expect((await rowsOf(ada)).map((row) => [row.ledgerId, row.cardId, row.attempt, row.chargeSentAt])).toEqual([[pending, NEW_CARD.id, 1, null]]);
        });

        it("AC20 (issue 254): with no card on file, a row with its charge out is busy still: no card goes on file, and the row keeps its moment", async () => {
          const ada = await subscriber({ card: false });
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          expect(await replace(ada)).toBe("busy");
          expect(await onFile(ada)).toBeNull();
          expect(await rowsOf(ada)).toEqual([claimedRow(ada, ledgerId, WEEK, 5000, "2027-01-25")]);
        });

        it("AC13 (issue 254): a declined row with its charge out is busy too: the card, the row and its moment stay", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([ledgerId]);
          expect(await replace(ada)).toBe("busy");
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
          expect(await rowsOf(ada)).toEqual([claimedRow(ada, ledgerId, WEEK, 5000, "2027-01-25")]);
        });

        it("AC13: a cancelled subscription is inactive, before busy: the card and a closed week's declined row stay", async () => {
          const ada = await subscriber();
          const closed = await addLedgerRow(ada.signup.subscriptionId, FEB_7, "declined", 5000);
          await close(FEB_7);
          await addLedgerRow(ada.signup.subscriptionId, NEXT, "pending", 5000);
          expect(await repo.cancelSubscription(ada.signup.subscriptionId, CLOSED_AT)).toBe(true);
          expect(await replace(ada)).toBe("inactive");
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([closed]);
        });

        it("AC13: an unknown id and a string that isn't a UUID are inactive", async () => {
          for (const id of [UNKNOWN_UUID, "not-a-uuid"]) expect(await repo.replaceSubscriptionCard(id, NEW_CARD)).toBe("inactive");
        });

        it("AC13: a replace that its withActor rolls back writes nothing", async () => {
          const ada = await subscriber();
          const closed = await addLedgerRow(ada.signup.subscriptionId, FEB_7, "declined", 5000);
          await close(FEB_7);
          const failure = new Error("fn failed after the replace");
          await expect(
            repo.withActor({ member: ada.memberId }, async (r) => {
              expect(await r.replaceSubscriptionCard(ada.signup.subscriptionId, NEW_CARD)).toBe("replaced");
              throw failure;
            }),
          ).rejects.toBe(failure);
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([closed]);
        });
      });

      // A pending signup's abandon is src/adapters/signup-contract.ts's.
      describe("abandonCharge on a card update's row (issue 254)", () => {
        it.each(["active", "cancelled"] as const)("AC12: on an %s subscription it is declined: the row, declined with its charge out, stays declined at its attempt, with no charge out, and the old card on file", async (status) => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[ledgerId, 2]]);
          if (status === "cancelled") expect(await repo.cancelSubscription(ada.signup.subscriptionId, CLOSED_AT)).toBe(true);
          expect(await repo.abandonCharge(ledgerId, CLAIMED_AT)).toBe("declined");
          expect((await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[ledgerId, 2]]);
          expect(await rowsOf(ada)).toEqual([]);
          expect(await onFile(ada)).toEqual(OLD_ON_FILE);
        });

        it("AC21: with another charge's moment it is null, and the charge stays out", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          expect(await repo.abandonCharge(ledgerId, LATER_AT)).toBeNull();
          expect((await rowsOf(ada)).map((row) => [row.ledgerId, row.attempt, row.chargeSentAt])).toEqual([[ledgerId, 2, CLAIMED_AT]]);
        });

        it("AC12: a charge run's row, pending on the card on file with no charge out, is null and stays pending at its attempt", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
          expect(await repo.abandonCharge(ledgerId, CLAIMED_AT)).toBeNull();
          expect((await rowsOf(ada)).map((row) => [row.ledgerId, row.attempt])).toEqual([[ledgerId, 1]]);
        });
      });

      // The rules are src/adapters/signup-contract.ts's; a card update's row is a declined one, and goes through each once.
      describe("markChargeSent, restartCharge, restoreChargeSent and a decline by attempt, on a card update's row (issue 254)", () => {
        /** Ada's declined row, claimed: its charge out at attempt 2 since CLAIMED_AT. */
        const claimed = async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          return { ledgerId, charge: async () => [(await declinedOf(ada)).map((row) => [row.ledgerId, row.attempt]), (await rowsOf(ada)).map((row) => row.chargeSentAt)] };
        };

        it("AC12: a mark, then its restore, at the row's attempt and moment: the row stays declined at its attempt", async () => {
          const { ledgerId, charge } = await claimed();
          expect(await repo.markChargeSent(ledgerId, 2, CLAIMED_AT, LATER_AT)).toEqual(LATER_AT);
          expect(await charge()).toEqual([[[ledgerId, 2]], [LATER_AT]]);
          expect(await repo.restoreChargeSent(ledgerId, 2, LATER_AT, CLAIMED_AT)).toBe(true);
          expect(await charge()).toEqual([[[ledgerId, 2]], [CLAIMED_AT]]);
        });

        it("AC12: a restart: the row stays declined, at the next attempt, out since the moment given", async () => {
          const { ledgerId, charge } = await claimed();
          expect(await repo.restartCharge(ledgerId, 2, CLAIMED_AT, LATER_AT)).toEqual({ attempt: 3, sentAt: LATER_AT });
          expect(await charge()).toEqual([[[ledgerId, 3]], [LATER_AT]]);
        });

        it("AC12: each is refused at the attempt the claim left, and a decline at it is false; at the row's own it is true", async () => {
          const { ledgerId, charge } = await claimed();
          expect(await repo.markChargeSent(ledgerId, 1, CLAIMED_AT, LATER_AT)).toBeNull();
          expect(await repo.restartCharge(ledgerId, 1, CLAIMED_AT, LATER_AT)).toBeNull();
          expect(await repo.restoreChargeSent(ledgerId, 1, CLAIMED_AT, LATER_AT)).toBe(false);
          expect(await repo.recordSignupDecline(ledgerId, 1)).toBe(false);
          expect(await charge()).toEqual([[[ledgerId, 2]], [CLAIMED_AT]]);
          expect(await repo.recordSignupDecline(ledgerId, 2)).toBe(true);
          expect(await charge()).toEqual([[[ledgerId, 2]], []]);
        });

        it("AC12: each is refused on the charge run's row, pending on the card on file with no charge out", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
          expect(await repo.markChargeSent(ledgerId, 1, CLAIMED_AT, LATER_AT)).toBeNull();
          expect(await repo.restartCharge(ledgerId, 1, CLAIMED_AT, LATER_AT)).toBeNull();
          expect(await repo.restoreChargeSent(ledgerId, 1, CLAIMED_AT, LATER_AT)).toBe(false);
          expect((await rowsOf(ada)).map((row) => [row.attempt, row.chargeSentAt])).toEqual([[1, null]]);
        });
      });

      // The row the card page reads: the charge run's select, so its key, card, customer and since are the run's.
      describe("findPendingCharge", () => {
        it("AC9: it is the subscription's oldest pending row, exactly as listPendingCharges lists it; another member's is not", async () => {
          const ada = await subscriber();
          const grace = await subscriber();
          await addLedgerRow(grace.signup.subscriptionId, WEEK, "pending", 5000);
          await addLedgerRow(ada.signup.subscriptionId, NEXT, "pending", 5000);
          const week = await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 4200);
          const [oldest] = await rowsOf(ada);
          expect(oldest?.ledgerId).toBe(week);
          expect(await repo.findPendingCharge(ada.signup.subscriptionId)).toEqual(oldest);
        });

        it("AC26 (issue 254): a row whose charge is out comes before a pending one, though its week is later", async () => {
          const ada = await subscriber();
          const ledgerId = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 5000);
          expect((await claim(ada)).kind).toBe("claimed");
          await addLedgerRow(ada.signup.subscriptionId, WEEK, "pending", 5000);
          expect(await repo.findPendingCharge(ada.signup.subscriptionId)).toEqual(claimedRow(ada, ledgerId, NEXT, 5000, "2027-02-01"));
        });

        it("AC8: it is null with no pending row: paid, declined and skipped rows are not", async () => {
          const ada = await subscriber();
          await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          await addLedgerRow(ada.signup.subscriptionId, NEXT, "paid", 5000);
          expect(await repo.skipWeek(ada.signup.subscriptionId, FEB_7)).toBe(true);
          expect(await repo.findPendingCharge(ada.signup.subscriptionId)).toBeNull();
          await addLedgerRow(ada.signup.subscriptionId, FEB_14, "pending", 5000);
          expect(await repo.findPendingCharge(ada.signup.subscriptionId)).toMatchObject({ pickupDate: FEB_14 });
        });

        it("AC8: it is null for a pending row whose subscription has no card, or whose member has no Square customer, as listPendingCharges leaves them out", async () => {
          const cardless = await subscriber({ card: false });
          const unlinked = await subscriber({ customer: false });
          await addLedgerRow(cardless.signup.subscriptionId, WEEK, "pending", 5000);
          await addLedgerRow(unlinked.signup.subscriptionId, WEEK, "pending", 5000);
          expect(await repo.findPendingCharge(cardless.signup.subscriptionId)).toBeNull();
          expect(await repo.findPendingCharge(unlinked.signup.subscriptionId)).toBeNull();
        });
      });

      // The "declined" decision: account home and the card page read it here, and the retry charges what it lists open.
      describe("listDeclinedCharges", () => {
        it("AC1, AC4: the subscription's declined rows, oldest week first, each with its ledger id, week, amount, attempt and whether its week is closed", async () => {
          const ada = await subscriber();
          const next = await addLedgerRow(ada.signup.subscriptionId, NEXT, "declined", 8000);
          const week = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          await close(NEXT);
          expect(await declinedOf(ada)).toEqual([
            { ledgerId: week, pickupDate: WEEK, amountCents: 5000, attempt: 1, closed: false },
            { ledgerId: next, pickupDate: NEXT, amountCents: 8000, attempt: 1, closed: true },
          ]);
        });

        it("AC1: only declined rows, and only the subscription's: paid, pending and skipped rows and another member's declined row are left out", async () => {
          const ada = await subscriber();
          const grace = await subscriber();
          const mine = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          await addLedgerRow(ada.signup.subscriptionId, NEXT, "paid", 5000);
          await addLedgerRow(ada.signup.subscriptionId, FEB_7, "pending", 5000);
          expect(await repo.skipWeek(ada.signup.subscriptionId, FEB_14)).toBe(true);
          await addLedgerRow(grace.signup.subscriptionId, WEEK, "declined", 5000);
          expect((await declinedOf(ada)).map((row) => row.ledgerId)).toEqual([mine]);
        });

        it("AC4: another product's closed week of the same date does not close the row's", async () => {
          const crate = await addProduct({ ...BOX, name: "Crate" });
          const ada = await subscriber();
          await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          await repo.closePickupWeek(crate.id, WEEK, null, CLOSED_AT);
          expect((await declinedOf(ada)).map((row) => row.closed)).toEqual([false]);
        });
      });

      // AC6's sentence names the one row in the URL only when it is this subscription's paid row.
      describe("findPaidCharge", () => {
        it("AC6: one of the subscription's paid rows: its ledger id, week and amount", async () => {
          const ada = await subscriber();
          const next = await addLedgerRow(ada.signup.subscriptionId, NEXT, "paid", 8000);
          expect(await repo.findPaidCharge(ada.signup.subscriptionId, next)).toEqual({ ledgerId: next, pickupDate: NEXT, amountCents: 8000 });
        });

        it("AC6: null for a declined or a pending row, another member's paid row, an unknown id and a string that isn't a UUID", async () => {
          const ada = await subscriber();
          const grace = await subscriber();
          const declined = await addLedgerRow(ada.signup.subscriptionId, WEEK, "declined", 5000);
          const pending = await addLedgerRow(ada.signup.subscriptionId, NEXT, "pending", 5000);
          const others = await addLedgerRow(grace.signup.subscriptionId, WEEK, "paid", 5000);
          for (const id of [declined, pending, others, UNKNOWN_UUID, "not-a-uuid"]) expect(await repo.findPaidCharge(ada.signup.subscriptionId, id)).toBeNull();
          expect(await repo.findPaidCharge(grace.signup.subscriptionId, others)).toEqual({ ledgerId: others, pickupDate: WEEK, amountCents: 5000 });
        });
      });
    });
  });
}
