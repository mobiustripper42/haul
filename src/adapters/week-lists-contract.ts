/**
 * Issue 142's repository contract, run against both adapters like `runChargeRunContract` (DEC-010), with the same
 * arguments and seams: `addLedgerRow`, a ledger row as the charge run would write it, returning its id. A skip is
 * written through `skipWeek`, a week credit spent through `enrolWeek`, picks switched through `switchPicks`.
 *
 * The rule owned here is AC1's: which subscriptions are a week's meals and which its skips, and what each carries.
 * The due rule's edges are the charge run contract's (`dueAsOf`, src/adapters/charge-run-contract.ts), the set in
 * effect for a week issue 138's (src/adapters/week-credit-contract.ts): one accepted and one rejected case of each
 * here. Neither list's order is part of the contract, so each is sorted by subscription.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { cutoffInstant } from "../pickup-week.js";
import type { PendingSignup, Repository, WeekBox, WeekBoxes, WeekMember } from "../ports/repository.js";
import type { ProductInput, ProductWithOptions } from "../products.js";
import { BOX } from "./contract-helpers.js";

type LedgerStatus = PendingSignup["ledgerStatus"];

export function runWeekListsContract(
  name: string,
  make: () => Promise<Repository>,
  addProduct: (input: ProductInput) => Promise<ProductWithOptions>,
  addLedgerRow: (subscriptionId: string, pickupDate: string, status: LedgerStatus, amountCents: number) => Promise<string>,
  reset?: () => Promise<void>,
): void {
  // BOX's weeks: January 24's cutoff is the end of Monday the 18th in Cleveland, 2027-01-19T05:00Z. The repository
  // checks no clock: the cutoff is what each call is given.
  describe(`Week lists repository contract — ${name}`, () => {
    const JAN_10 = "2027-01-10";
    const EARLIER = "2027-01-17";
    const WEEK = "2027-01-24";
    const NEXT = "2027-01-31";
    const CONSENT_AT = new Date("2027-01-05T15:00:00.000Z");
    const PAID_AT = new Date("2027-01-05T15:00:05.000Z");
    const CLOSED_AT = new Date("2027-01-12T15:00:00.000Z");

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

    /** The set at `size` and `menu` of `product` as a read gives it: each type's name and its option's. */
    const meal = (size: number, menu: number): { typeName: string; optionName: string }[] => {
      const [sizes, menus] = product.optionTypes;
      return [
        { typeName: sizes?.name ?? "no size type", optionName: sizes?.options[size]?.name ?? "no such size" },
        { typeName: menus?.name ?? "no menu type", optionName: menus?.options[menu]?.name ?? "no such menu" },
      ];
    };

    type Person = { email: string; firstName: string; lastName: string; phone: string };
    type Subscriber = { person: Person; signup: PendingSignup };

    /**
     * A new member with a name, email and phone, and their signup for `firstWeek` at `picks`: paid (the subscription
     * active) unless `paid` is false.
     */
    const subscriber = async ({
      firstWeek = EARLIER,
      picks,
      paid = true,
      on = product,
    }: { firstWeek?: string; picks?: Record<string, string>; paid?: boolean; on?: ProductWithOptions } = {}): Promise<Subscriber> => {
      const n = ++members;
      const person: Person = { email: `member-${n}@example.com`, firstName: `First ${n}`, lastName: `Last ${n}`, phone: `216-555-01${String(n).padStart(2, "0")}` };
      const member = await repo.saveAccount({ ...person, language: "en" });
      const signup = await repo.savePendingSignup({
        memberId: member.id,
        productId: on.id,
        choices: picks ?? choices(0, 0, on),
        firstChargeCents: 5000,
        weeklyCents: 5000,
        pickupDate: firstWeek,
        consentText: "I agree to a weekly charge of $50.",
        consentAt: CONSENT_AT,
      });
      if (paid) expect(await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, 5000, PAID_AT)).toBe("confirmed");
      return { person, signup };
    };

    const bySubscription = (a: { subscriptionId: string }, b: { subscriptionId: string }) => a.subscriptionId.localeCompare(b.subscriptionId);

    /** The week's lists, as of its cutoff, each sorted by subscription. */
    const lists = async (week: string = WEEK, of: ProductWithOptions = product): Promise<WeekBoxes> => {
      const found = await repo.listWeekBoxes(of.id, week, cutoffInstant(of, week));
      return { boxes: [...found.boxes].sort(bySubscription), skips: [...found.skips].sort(bySubscription) };
    };

    /** `who` as a skip: its member's names, email and phone, and `options`. */
    const asMember = (who: Subscriber, options: WeekMember["options"]): WeekMember => ({
      subscriptionId: who.signup.subscriptionId,
      firstName: who.person.firstName,
      lastName: who.person.lastName,
      email: who.person.email,
      phone: who.person.phone,
      options,
    });

    /** `who` as a meal: no week credit and no declined card unless `over` says so. */
    const asBox = (who: Subscriber, options: WeekBox["options"], over: Partial<Pick<WeekBox, "weekCredit" | "cardDeclined">> = {}): WeekBox => ({
      ...asMember(who, options),
      weekCredit: false,
      cardDeclined: false,
      ...over,
    });

    const sortedBoxes = (...boxes: WeekBox[]): WeekBox[] => [...boxes].sort(bySubscription);

    describe("AC1 — a row for the week", () => {
      it("AC1: a paid row for the week is a meal: the member's names, email and phone, the row's picks in option-type position order, no week credit, no declined card", async () => {
        const ada = await subscriber({ firstWeek: WEEK, picks: choices(1, 1) });
        expect(await lists()).toEqual({ boxes: [asBox(ada, meal(1, 1))], skips: [] });
      });

      it.each([
        ["pending", false],
        ["declined", true],
      ] as const)("AC1: a %s row for the week is a meal too, cardDeclined %s", async (status, cardDeclined) => {
        const ada = await subscriber();
        await addLedgerRow(ada.signup.subscriptionId, WEEK, status, 5000);
        expect(await lists()).toEqual({ boxes: [asBox(ada, meal(0, 0), { cardDeclined })], skips: [] });
      });

      it("AC1: a skipped row is a skip, carrying the picks in effect for the week, and not a meal", async () => {
        const ada = await subscriber();
        const grace = await subscriber();
        expect(await repo.switchPicks(ada.signup.subscriptionId, choices(1, 1), WEEK, 8000)).toBe("switched");
        expect(await repo.skipWeek(ada.signup.subscriptionId, WEEK)).toBe(true);
        expect(await lists()).toEqual({ boxes: [asBox(grace, meal(0, 0))], skips: [asMember(ada, meal(1, 1))] });
      });

      it("AC1 [code]: a cancelled subscription's rows count: its paid row for the week is a meal, its skipped row a skip", async () => {
        const ada = await subscriber();
        const grace = await subscriber();
        await addLedgerRow(ada.signup.subscriptionId, WEEK, "paid", 5000);
        expect(await repo.skipWeek(grace.signup.subscriptionId, WEEK)).toBe(true);
        // A moment before the cutoff: neither is due by the rule, so only the rows can put them on the lists.
        const before = new Date(cutoffInstant(product, WEEK).getTime() - 1);
        expect(await repo.cancelSubscription(ada.signup.subscriptionId, before)).toBe(true);
        expect(await repo.cancelSubscription(grace.signup.subscriptionId, before)).toBe(true);
        expect(await lists()).toEqual({ boxes: [asBox(ada, meal(0, 0))], skips: [asMember(grace, meal(0, 0))] });
      });

      it("AC1 [code]: a pending subscription's row for the week, a signup in progress or declined at signup, is neither a meal nor a skip", async () => {
        const due = await subscriber();
        await subscriber({ firstWeek: WEEK, paid: false });
        const declined = await subscriber({ firstWeek: WEEK, paid: false });
        expect(await repo.recordSignupDecline(declined.signup.ledgerId)).toBe(true);
        expect(await lists()).toEqual({ boxes: [asBox(due, meal(0, 0))], skips: [] });
      });

      it("AC1: another week's row and another product's subscription are not this week's", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const ada = await subscriber({ firstWeek: WEEK });
        await subscriber({ firstWeek: NEXT });
        await subscriber({ firstWeek: WEEK, on: crate });
        expect(await lists()).toEqual({ boxes: [asBox(ada, meal(0, 0))], skips: [] });
      });
    });

    describe("AC1 — no row for the week", () => {
      it("AC1: a subscription due the week with no row is a meal of its picks in effect for the week: a set from the week on counts, a set from a later week does not", async () => {
        const ada = await subscriber();
        const grace = await subscriber();
        expect(await repo.switchPicks(ada.signup.subscriptionId, choices(1, 1), WEEK, 8000)).toBe("switched");
        expect(await repo.switchPicks(grace.signup.subscriptionId, choices(1, 0), NEXT, 8000)).toBe("switched");
        expect(await lists()).toEqual({ boxes: sortedBoxes(asBox(ada, meal(1, 1)), asBox(grace, meal(0, 0))), skips: [] });
      });

      it("AC1: a subscription not due the week, cancelled a moment before its cutoff, with no row, is neither a meal nor a skip", async () => {
        const ada = await subscriber();
        const due = await subscriber();
        expect(await repo.cancelSubscription(ada.signup.subscriptionId, new Date(cutoffInstant(product, WEEK).getTime() - 1))).toBe(true);
        expect(await lists()).toEqual({ boxes: [asBox(due, meal(0, 0))], skips: [] });
      });

      it("AC1 [you]: the list adds no week-credit logic: with no row, a subscription holding an unspent week credit is a meal of its picks in effect, weekCredit false", async () => {
        const ada = await subscriber();
        await repo.closePickupWeek(product.id, EARLIER, null, CLOSED_AT);
        expect(await repo.switchPicks(ada.signup.subscriptionId, choices(1, 1), WEEK, 8000)).toBe("switched");
        expect(await lists()).toEqual({ boxes: [asBox(ada, meal(1, 1))], skips: [] });
      });
    });

    // Issue 196: the lock's edges are the charge run contract's (src/adapters/charge-run-contract.ts); here one locked
    // and one unlocked case through the due rule, and the locked row the list drops.
    describe("issue 196 — AC2: a locked subscription is neither a meal nor a skip", () => {
      it("AC2: a subscription holding a declined row for an earlier week, with no row for the week, is neither a meal nor a skip; one whose declined row is the week's own is a meal, cardDeclined", async () => {
        const ada = await subscriber({ firstWeek: JAN_10 });
        const grace = await subscriber({ firstWeek: JAN_10 });
        await addLedgerRow(ada.signup.subscriptionId, EARLIER, "declined", 5000);
        await addLedgerRow(grace.signup.subscriptionId, WEEK, "declined", 5000);
        expect(await lists()).toEqual({ boxes: [asBox(grace, meal(0, 0), { cardDeclined: true })], skips: [] });
      });

      it("AC2: a locked row is neither a meal nor a skip, and stays off the lists once the lock has ended", async () => {
        const ada = await subscriber({ firstWeek: JAN_10 });
        const due = await subscriber({ firstWeek: JAN_10 });
        const declinedId = await addLedgerRow(ada.signup.subscriptionId, EARLIER, "declined", 5000);
        expect((await repo.enrolWeek(product.id, WEEK, cutoffInstant(product, WEEK))).locked).toHaveLength(1);
        const expected = { boxes: [asBox(due, meal(0, 0))], skips: [] };
        expect(await lists()).toEqual(expected);
        expect(await repo.confirmSignupRows(declinedId, `PAYMENT_${declinedId}`, 5000, CLOSED_AT)).toBe("confirmed");
        expect(await lists()).toEqual(expected);
      });
    });

    describe("AC1 — what a meal says", () => {
      it("AC1: a row a week credit paid is a meal saying so, of the spent week credit's picks, not the set in effect for the week", async () => {
        const ada = await subscriber();
        await repo.closePickupWeek(product.id, EARLIER, null, CLOSED_AT);
        expect(await repo.switchPicks(ada.signup.subscriptionId, choices(1, 1), WEEK, 8000)).toBe("switched");
        expect((await repo.enrolWeek(product.id, WEEK, cutoffInstant(product, WEEK))).byWeekCredit).toHaveLength(1);
        expect(await lists()).toEqual({ boxes: [asBox(ada, meal(0, 0), { weekCredit: true })], skips: [] });
      });

      it("AC1 [you]: cardDeclined is a declined row in any week: a meal paid for the week, holding a declined row for an earlier one, is cardDeclined; one with none is not", async () => {
        const ada = await subscriber({ firstWeek: JAN_10 });
        const grace = await subscriber({ firstWeek: JAN_10 });
        await addLedgerRow(ada.signup.subscriptionId, EARLIER, "declined", 5000);
        await addLedgerRow(ada.signup.subscriptionId, WEEK, "paid", 5000);
        await addLedgerRow(grace.signup.subscriptionId, WEEK, "paid", 5000);
        expect(await lists()).toEqual({ boxes: sortedBoxes(asBox(ada, meal(0, 0), { cardDeclined: true }), asBox(grace, meal(0, 0))), skips: [] });
      });

      it("AC1 [Lead]: the flag does not depend on the subscription's status: a cancelled subscription due its meal and holding a declined row is cardDeclined", async () => {
        const ada = await subscriber({ firstWeek: JAN_10 });
        await addLedgerRow(ada.signup.subscriptionId, EARLIER, "declined", 5000);
        await addLedgerRow(ada.signup.subscriptionId, WEEK, "paid", 5000);
        expect(await repo.cancelSubscription(ada.signup.subscriptionId, cutoffInstant(product, WEEK))).toBe(true);
        expect(await lists()).toEqual({ boxes: [asBox(ada, meal(0, 0), { cardDeclined: true })], skips: [] });
      });

      it("AC1: the picks are in option-type position order, not the order the types were written in", async () => {
        const [sizes, menus] = BOX.optionTypes;
        if (!sizes || !menus) throw new Error("BOX has two option types");
        const menuFirst = await addProduct({ ...BOX, name: "Menu first", optionTypes: [{ ...sizes, position: 2 }, { ...menus, position: 1 }] });
        const byName = (typeName: string) => menuFirst.optionTypes.find((type) => type.name === typeName);
        const picks = Object.fromEntries([sizes.name, menus.name].map((typeName) => [byName(typeName)?.id ?? "no such type", byName(typeName)?.options[0]?.id ?? "no such option"]));
        await subscriber({ firstWeek: WEEK, picks, on: menuFirst });
        expect((await lists(WEEK, menuFirst)).boxes.map((box) => box.options)).toEqual([
          [
            { typeName: menus.name, optionName: menus.options[0]?.name },
            { typeName: sizes.name, optionName: sizes.options[0]?.name },
          ],
        ]);
      });
    });
  });
}
