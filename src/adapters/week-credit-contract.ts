/**
 * The week credit repository contract, run against both adapters like `runRepositoryContract` (DEC-010).
 *
 * `runWeekCreditContract` is issue 149's: closing and reopening a week, and the week credits closing grants. It
 * takes `addProduct` and two seams each adapter's repository test file passes in: `addLedgerRow`, a ledger row
 * as the charge run would write it, and `setSubscriptionOptions`, a subscription's picks replaced as a switch
 * would (task 2.6). The fake has a method for each; Postgres writes them with raw SQL.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ChangedWeek } from "../pickup-week.js";
import type { PendingSignup, Repository } from "../ports/repository.js";
import type { ProductInput, ProductWithOptions } from "../products.js";
import { BOX, UUID } from "./contract-helpers.js";

type LedgerStatus = PendingSignup["ledgerStatus"];

export function runWeekCreditContract(
  name: string,
  make: () => Promise<Repository>,
  addProduct: (input: ProductInput) => Promise<ProductWithOptions>,
  addLedgerRow: (subscriptionId: string, pickupDate: string, status: LedgerStatus, amountCents: number) => Promise<void>,
  setSubscriptionOptions: (subscriptionId: string, optionIds: string[]) => Promise<void>,
  spendWeekCredit: (weekCreditId: string, ledgerId: string) => Promise<void>,
  reset?: () => Promise<void>,
): void {
  // Issue 149. The weeks are BOX's: January 24's cutoff is the end of Monday the 18th. The repository checks no
  // cutoff (the core does), so the times here are only what each call is given.
  describe(`Week credit repository contract — ${name}`, () => {
    const WEEK = "2027-01-24";
    const NEXT = "2027-01-31";
    const EARLIER = "2027-01-17";
    const PAID_AT = new Date("2027-01-05T15:00:00.000Z");
    const CLOSED_AT = new Date("2027-01-12T15:00:00.000Z");
    const LATER = new Date("2027-01-13T15:00:00.000Z");

    let repo: Repository;
    let product: ProductWithOptions;
    let members = 0;

    beforeEach(async () => {
      if (reset) await reset();
      repo = await make();
      product = await addProduct(BOX);
    });

    /** The option ids at `size` and `menu` of `on`. */
    const picks = (size: number, menu: number, on: ProductWithOptions = product): string[] => {
      const [sizes, menus] = on.optionTypes;
      return [sizes?.options[size]?.id ?? "no such size", menus?.options[menu]?.id ?? "no such menu"];
    };

    const choicesOf = (ids: string[], on: ProductWithOptions = product): Record<string, string> =>
      Object.fromEntries(on.optionTypes.map((type, i) => [type.id, ids[i] ?? "no such option"]));

    const sorted = (ids: readonly string[] | undefined) => [...(ids ?? [])].sort();

    /** A new member's pending rows for `week`, picking `ids`. */
    const pendingFor = async (week: string, ids: string[] = picks(0, 0), on: ProductWithOptions = product): Promise<PendingSignup> => {
      const memberId = (await repo.createMember({ email: `member-${++members}@example.com` })).id;
      const signup = await repo.savePendingSignup({
        memberId,
        productId: on.id,
        choices: choicesOf(ids, on),
        firstChargeCents: 5000,
        weeklyCents: 5000,
        pickupDate: week,
        consentText: "I agree to a weekly charge of $50.",
        consentAt: PAID_AT,
      });
      expect(signup.ledgerId).not.toBe("");
      return signup;
    };

    const confirm = (signup: PendingSignup, at: Date = PAID_AT) =>
      repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, at);

    /** A new member's signup for `week`, charged at signup: an active subscription with a paid row for the week. */
    const paidFor = async (week: string, ids?: string[], on?: ProductWithOptions): Promise<PendingSignup> => {
      const signup = await pendingFor(week, ids, on);
      expect(await confirm(signup)).toBe("confirmed");
      return signup;
    };

    const close = (week: string, note: string | null = "Kitchen flooded", at: Date = CLOSED_AT) => repo.closePickupWeek(product.id, week, note, at);

    const credits = async (week: string = WEEK) =>
      [...(await repo.listWeekCredits(product.id, week))].sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId));

    const changedWeek = async (week: string = WEEK): Promise<ChangedWeek | null> =>
      (await repo.listChangedWeeks(product.id, week)).find((changed) => changed.weekOf === week) ?? null;

    describe("AC2 — closing a week", () => {
      it("AC2: closePickupWeek closes the week at the time given, with its note", async () => {
        await close(WEEK, "Kitchen flooded");
        expect(await changedWeek()).toEqual({ weekOf: WEEK, closedAt: CLOSED_AT, note: "Kitchen flooded", firstDay: null, lastDay: null });
      });

      it("AC2: closed with no note, its note is null", async () => {
        await close(WEEK, null);
        expect(await changedWeek()).toEqual({ weekOf: WEEK, closedAt: CLOSED_AT, note: null, firstDay: null, lastDay: null });
      });

      it("AC7: closing a moved week keeps its days", async () => {
        await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-23", lastDay: "2027-01-24" });
        await close(WEEK, "Kitchen flooded");
        expect(await changedWeek()).toEqual({ weekOf: WEEK, closedAt: CLOSED_AT, note: "Kitchen flooded", firstDay: "2027-01-23", lastDay: "2027-01-24" });
      });
    });

    describe("AC3 — the week credits closing grants", () => {
      it("AC3: each subscription with a paid row for the week gets one week credit for that row, granted at the closing time and unspent", async () => {
        const ada = await paidFor(WEEK);
        const grace = await paidFor(WEEK);
        await close(WEEK);
        const expected = [ada, grace]
          .map((signup) => ({
            id: expect.stringMatching(UUID),
            subscriptionId: signup.subscriptionId,
            grantedFor: signup.ledgerId,
            spentOn: null,
            grantedAt: CLOSED_AT,
            optionIds: expect.any(Array),
          }))
          .sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId));
        expect(await credits()).toEqual(expected);
      });

      it("AC3: a paid row the charge run wrote, on a subscription that started earlier, gets one too", async () => {
        const signup = await paidFor(EARLIER);
        await addLedgerRow(signup.subscriptionId, WEEK, "paid", 5000);
        await close(WEEK);
        const found = await credits();
        expect(found.map((credit) => credit.subscriptionId)).toEqual([signup.subscriptionId]);
        expect(found[0]?.grantedFor).toMatch(UUID);
        expect(found[0]?.grantedFor).not.toBe(signup.ledgerId);
      });

      it("AC3: a pending row and a declined row get none, at signup or from the run: only the paid row does", async () => {
        const paid = await paidFor(WEEK);
        await pendingFor(WEEK);
        const declined = await pendingFor(WEEK);
        await repo.recordSignupDecline(declined.ledgerId);
        const runPending = await paidFor(EARLIER);
        await addLedgerRow(runPending.subscriptionId, WEEK, "pending", 5000);
        const runDeclined = await paidFor(EARLIER);
        await addLedgerRow(runDeclined.subscriptionId, WEEK, "declined", 5000);
        await close(WEEK);
        expect((await credits()).map((credit) => credit.subscriptionId)).toEqual([paid.subscriptionId]);
      });

      it("AC3: another week's paid row and another product's paid row for the same week get none", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const paid = await paidFor(WEEK);
        await paidFor(EARLIER);
        await paidFor(WEEK, picks(0, 0, crate), crate);
        await close(WEEK);
        expect((await credits()).map((credit) => credit.subscriptionId)).toEqual([paid.subscriptionId]);
        expect(await repo.listWeekCredits(crate.id, WEEK)).toEqual([]);
      });

      it("AC3: a close that its withActor rolls back leaves the week open and grants nothing", async () => {
        await paidFor(WEEK);
        const failure = new Error("fn failed after closing");
        await expect(
          repo.withActor(null, async (r) => {
            await r.closePickupWeek(product.id, WEEK, "Kitchen flooded", CLOSED_AT);
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await changedWeek()).toBeNull();
        expect(await credits()).toEqual([]);
      });
    });

    describe("AC4 — a week credit holds the picks that were charged", () => {
      it("AC4: a week credit holds the subscription's full set of picks", async () => {
        await paidFor(WEEK, picks(1, 1));
        await close(WEEK);
        expect((await credits()).map((credit) => sorted(credit.optionIds))).toEqual([sorted(picks(1, 1))]);
      });

      it("AC4: the picks are the subscription's at the grant: changed before the closing, the week credit holds the new ones", async () => {
        const signup = await paidFor(WEEK, picks(0, 0));
        await setSubscriptionOptions(signup.subscriptionId, picks(1, 0));
        await close(WEEK);
        expect((await credits()).map((credit) => sorted(credit.optionIds))).toEqual([sorted(picks(1, 0))]);
      });

      it("AC4: changing the subscription's picks after the grant does not change the week credit", async () => {
        const signup = await paidFor(WEEK, picks(1, 1));
        await close(WEEK);
        await setSubscriptionOptions(signup.subscriptionId, picks(0, 0));
        expect((await credits()).map((credit) => sorted(credit.optionIds))).toEqual([sorted(picks(1, 1))]);
      });
    });

    describe("AC5 — a week closed twice", () => {
      it("AC5: a second close grants no second week credit, and the first closing time is kept", async () => {
        const signup = await paidFor(WEEK);
        await close(WEEK, "Kitchen flooded", CLOSED_AT);
        await close(WEEK, "Kitchen flooded", LATER);
        expect(await credits()).toEqual([expect.objectContaining({ subscriptionId: signup.subscriptionId, grantedAt: CLOSED_AT })]);
        expect((await changedWeek())?.closedAt).toEqual(CLOSED_AT);
      });
    });

    describe("AC7 — reopening a week", () => {
      it("AC7: a reopened week with no move is ordinary again, no row, and the week credits its closing granted are gone", async () => {
        await paidFor(WEEK);
        await close(WEEK, "Kitchen flooded");
        expect(await credits()).toHaveLength(1);
        await repo.reopenPickupWeek(product.id, WEEK);
        expect(await changedWeek()).toBeNull();
        expect(await credits()).toEqual([]);
      });

      it("AC7: a move on the week stays: open again, the note cleared, the days kept", async () => {
        await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-23", lastDay: "2027-01-24" });
        await close(WEEK, "Kitchen flooded");
        expect((await changedWeek())?.closedAt).toEqual(CLOSED_AT);
        await repo.reopenPickupWeek(product.id, WEEK);
        expect(await changedWeek()).toEqual({ weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-23", lastDay: "2027-01-24" });
      });

      it("AC7: it withdraws that week's week credits and no other week's", async () => {
        await paidFor(WEEK);
        const next = await paidFor(NEXT);
        await close(WEEK);
        await close(NEXT);
        expect(await credits(NEXT)).toHaveLength(1);
        await repo.reopenPickupWeek(product.id, WEEK);
        expect(await credits(WEEK)).toEqual([]);
        expect((await credits(NEXT)).map((credit) => credit.subscriptionId)).toEqual([next.subscriptionId]);
      });

      it("AC7, AC5: a week reopened and closed again grants its week credits again, once, at the new closing", async () => {
        await paidFor(WEEK);
        await close(WEEK, "Kitchen flooded", CLOSED_AT);
        await repo.reopenPickupWeek(product.id, WEEK);
        await close(WEEK, null, LATER);
        expect(await credits()).toEqual([expect.objectContaining({ grantedAt: LATER })]);
      });
    });

    describe("AC10 — no row is an ordinary week", () => {
      it("AC10: savePickupWeek with no close, no move and no note leaves the week with no row", async () => {
        await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-23", lastDay: "2027-01-24" });
        await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: null, lastDay: null });
        expect(await repo.listChangedWeeks(product.id, EARLIER)).toEqual([]);
      });

      it("AC10: a week left with only its note keeps its row, which guards the delete above", async () => {
        const noted: ChangedWeek = { weekOf: WEEK, closedAt: null, note: "Heads up", firstDay: null, lastDay: null };
        await repo.savePickupWeek(product.id, { ...noted, firstDay: "2027-01-23", lastDay: "2027-01-24" });
        await repo.savePickupWeek(product.id, noted);
        expect(await repo.listChangedWeeks(product.id, EARLIER)).toEqual([noted]);
      });
    });

    describe("AC12 — a signup confirmed paid after its week closed", () => {
      it("AC12: a signup pending when its week closes gets its week credit when it confirms paid, granted at the confirmation's time", async () => {
        const signup = await pendingFor(WEEK, picks(1, 1));
        await close(WEEK);
        expect(await credits()).toEqual([]);
        expect(await confirm(signup, LATER)).toBe("confirmed");
        const found = await credits();
        expect(found).toEqual([
          { id: expect.stringMatching(UUID), subscriptionId: signup.subscriptionId, grantedFor: signup.ledgerId, spentOn: null, grantedAt: LATER, optionIds: expect.any(Array) },
        ]);
        expect(sorted(found[0]?.optionIds)).toEqual(sorted(picks(1, 1)));
      });

      it("AC12: a confirmation for an open week grants nothing, though another week is closed", async () => {
        const signup = await pendingFor(WEEK);
        await close(NEXT);
        expect(await confirm(signup, LATER)).toBe("confirmed");
        expect(await credits(WEEK)).toEqual([]);
        expect(await credits(NEXT)).toEqual([]);
      });

      it('AC12, AC5: a replayed confirmation ("already") grants no second week credit', async () => {
        const signup = await pendingFor(WEEK);
        await close(WEEK);
        await confirm(signup, LATER);
        expect(await confirm(signup, LATER)).toBe("already");
        expect(await credits()).toHaveLength(1);
      });
    });

    describe("AC14 — listWeekCounts", () => {
      it("AC14: per week from the date on, the paid rows, from signup and from the run, and the week credits granted", async () => {
        await paidFor(WEEK);
        const runRow = await paidFor(EARLIER);
        await addLedgerRow(runRow.subscriptionId, WEEK, "paid", 5000);
        await pendingFor(WEEK);
        await paidFor(NEXT);
        await close(WEEK);
        const counts = await repo.listWeekCounts(product.id, WEEK);
        expect(counts.get(WEEK)).toEqual({ paid: 2, weekCredits: 2 });
        expect(counts.get(NEXT)).toEqual({ paid: 1, weekCredits: 0 });
        expect(counts.has(EARLIER)).toBe(false);
      });

      it("AC14: another product's rows are not counted", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        await paidFor(WEEK);
        await paidFor(WEEK, picks(0, 0, crate), crate);
        expect((await repo.listWeekCounts(product.id, WEEK)).get(WEEK)).toEqual({ paid: 1, weekCredits: 0 });
      });
    });

    // Issue 155: what a member's account pages read of one subscription. Neither list's order is part of the
    // contract, so each is sorted here.
    describe("issue 155 — listMemberWeeks", () => {
      const weeksOf = async (subscriptionId: string) => {
        const found = await repo.listMemberWeeks(subscriptionId);
        return {
          paid: [...found.paid].sort((a, b) => a.weekOf.localeCompare(b.weekOf)),
          weekCredits: [...found.weekCredits].sort((a, b) => a.grantedForWeek.localeCompare(b.grantedForWeek)),
        };
      };

      it("AC3 (issue 155): the subscription's paid rows, from signup and from the charge run, each with its week and the amount charged", async () => {
        const signup = await paidFor(EARLIER);
        await addLedgerRow(signup.subscriptionId, WEEK, "paid", 4200);
        expect((await weeksOf(signup.subscriptionId)).paid).toEqual([
          { weekOf: EARLIER, amountCents: 5000 },
          { weekOf: WEEK, amountCents: 4200 },
        ]);
      });

      it("AC3 (issue 155): a pending row and a declined row are not paid rows, and another subscription's paid row is not this one's", async () => {
        const signup = await paidFor(EARLIER);
        await addLedgerRow(signup.subscriptionId, WEEK, "pending", 5000);
        await addLedgerRow(signup.subscriptionId, NEXT, "declined", 5000);
        await paidFor(WEEK);
        expect((await weeksOf(signup.subscriptionId)).paid).toEqual([{ weekOf: EARLIER, amountCents: 5000 }]);
      });

      it("AC5 (issue 155): its unspent week credits, each with the week of the paid row it was granted for; another subscription's are not its", async () => {
        const signup = await paidFor(EARLIER);
        await addLedgerRow(signup.subscriptionId, WEEK, "paid", 5000);
        await paidFor(WEEK);
        await close(EARLIER);
        await close(WEEK);
        expect((await weeksOf(signup.subscriptionId)).weekCredits).toEqual([{ grantedForWeek: EARLIER }, { grantedForWeek: WEEK }]);
      });

      it("AC5 (issue 155): a week credit the charge run spent is left out", async () => {
        const signup = await paidFor(WEEK);
        await close(WEEK);
        const [spent] = await credits(WEEK);
        // NEXT's paid row, the charge the week credit is spent on. Its id is read from the week credit closing NEXT
        // grants for it: the contract shows a run row's id nowhere else.
        await addLedgerRow(signup.subscriptionId, NEXT, "paid", 5000);
        await close(NEXT);
        const [nextCredit] = await credits(NEXT);
        if (!spent || !nextCredit) throw new Error("closing WEEK and NEXT granted no week credit to spend");
        await spendWeekCredit(spent.id, nextCredit.grantedFor);
        expect((await weeksOf(signup.subscriptionId)).weekCredits).toEqual([{ grantedForWeek: NEXT }]);
      });

      it("AC3 (issue 155): an unknown id and a string that isn't a UUID give nothing", async () => {
        await paidFor(WEEK);
        for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
          expect(await repo.listMemberWeeks(id)).toEqual({ paid: [], weekCredits: [], skipped: [] });
        }
      });
    });

    // Issue 137: a skip is a ledger row of its own, status `skipped`, read back through listMemberWeeks. The
    // repository checks no cutoff and no listing (the actions do: app/account/weeks/actions.test.ts), only the
    // subscription's ledger rows for the week. A refusal of a week with a pending or declined row is owned here: the
    // account pages read such a week as Coming.
    describe("issue 137 — skipWeek and unskipWeek", () => {
      const skippedOf = async (subscriptionId: string) => (await repo.listMemberWeeks(subscriptionId)).skipped;

      it("AC1: skipWeek stores the subscription's skipped row for the week: true, and the week reads as skipped, not paid", async () => {
        const signup = await paidFor(EARLIER);
        expect(await repo.skipWeek(signup.subscriptionId, WEEK)).toBe(true);
        expect(await skippedOf(signup.subscriptionId)).toEqual([WEEK]);
        expect((await repo.listMemberWeeks(signup.subscriptionId)).paid).toEqual([{ weekOf: EARLIER, amountCents: 5000 }]);
      });

      it("AC1: each week skipped is a row of its own, and another subscription's row for the week does not stand in the way", async () => {
        const ada = await paidFor(EARLIER);
        const grace = await paidFor(EARLIER);
        await addLedgerRow(grace.subscriptionId, WEEK, "paid", 5000);
        expect(await repo.skipWeek(ada.subscriptionId, WEEK)).toBe(true);
        expect(await repo.skipWeek(ada.subscriptionId, NEXT)).toBe(true);
        const skipped = await skippedOf(ada.subscriptionId);
        expect(skipped).toHaveLength(2);
        expect(skipped).toEqual(expect.arrayContaining([WEEK, NEXT]));
        expect(await skippedOf(grace.subscriptionId)).toEqual([]);
      });

      it.each(["paid", "pending", "declined"] as const)("AC4: skipWeek refuses a week that already has a %s row: false, and nothing is written", async (status) => {
        const signup = await paidFor(EARLIER);
        await addLedgerRow(signup.subscriptionId, WEEK, status, 5000);
        expect(await repo.skipWeek(signup.subscriptionId, WEEK)).toBe(false);
        expect(await skippedOf(signup.subscriptionId)).toEqual([]);
      });

      it("AC4: a second skipWeek for a skipped week is false, and leaves the one skipped row", async () => {
        const signup = await paidFor(EARLIER);
        expect(await repo.skipWeek(signup.subscriptionId, WEEK)).toBe(true);
        expect(await repo.skipWeek(signup.subscriptionId, WEEK)).toBe(false);
        expect(await skippedOf(signup.subscriptionId)).toEqual([WEEK]);
      });

      it("AC2: unskipWeek deletes the skipped row: true, the week is no longer skipped, and it can be skipped again", async () => {
        const signup = await paidFor(EARLIER);
        await repo.skipWeek(signup.subscriptionId, WEEK);
        expect(await repo.unskipWeek(signup.subscriptionId, WEEK)).toBe(true);
        expect(await skippedOf(signup.subscriptionId)).toEqual([]);
        expect(await repo.skipWeek(signup.subscriptionId, WEEK)).toBe(true);
      });

      it("AC2: unskipWeek deletes that subscription's row for that week, and no other", async () => {
        const ada = await paidFor(EARLIER);
        const grace = await paidFor(EARLIER);
        await repo.skipWeek(ada.subscriptionId, WEEK);
        await repo.skipWeek(ada.subscriptionId, NEXT);
        await repo.skipWeek(grace.subscriptionId, WEEK);
        expect(await repo.unskipWeek(ada.subscriptionId, WEEK)).toBe(true);
        expect(await skippedOf(ada.subscriptionId)).toEqual([NEXT]);
        expect(await skippedOf(grace.subscriptionId)).toEqual([WEEK]);
      });

      it.each(["paid", "pending", "declined"] as const)("AC4: unskipWeek leaves a %s row alone: false, and the row is still there", async (status) => {
        const signup = await paidFor(EARLIER);
        await addLedgerRow(signup.subscriptionId, WEEK, status, 5000);
        expect(await repo.unskipWeek(signup.subscriptionId, WEEK)).toBe(false);
        // The row stands in the way of a skip, so it is still there.
        expect(await repo.skipWeek(signup.subscriptionId, WEEK)).toBe(false);
      });

      it("AC4: unskipWeek for a week with no ledger row is false", async () => {
        const signup = await paidFor(EARLIER);
        expect(await repo.unskipWeek(signup.subscriptionId, WEEK)).toBe(false);
      });
    });
  });
}
