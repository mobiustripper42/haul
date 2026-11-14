/**
 * The signup repository contract, run against both adapters like `runRepositoryContract` (DEC-010).
 *
 * `runSignupContract` is issue 56's repository methods. A signup needs a product with options, so it
 * takes `addProduct` as `runProductContract` does, and the adapters' product test files call it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AccountDetails } from "../create-account.js";
import type { ChangedWeek } from "../pickup-week.js";
import type { PendingSignup, PendingSignupInput, Repository } from "../ports/repository.js";
import type { ProductInput, ProductWithOptions } from "../products.js";
import { BOX, UUID } from "./contract-helpers.js";

export function runSignupContract(
  name: string,
  make: () => Promise<Repository>,
  addProduct: (input: ProductInput) => Promise<ProductWithOptions>,
  reset?: () => Promise<void>,
): void {
  describe(`Signup repository contract — ${name}`, () => {
    const CONSENT_AT = new Date("2026-11-06T15:00:00.000Z");
    const PAID_AT = new Date("2026-11-06T15:00:05.000Z");

    let repo: Repository;
    let product: ProductWithOptions;
    let memberId: string;

    beforeEach(async () => {
      if (reset) await reset();
      repo = await make();
      product = await addProduct(BOX);
      memberId = (await repo.createMember({ email: "ada@example.com" })).id;
    });

    /** The option at `size` and `menu`: a type or option the product lacks gives an id that matches nothing. */
    const picks = (size: number, menu: number): Record<string, string> => {
      const [sizes, menus] = product.optionTypes;
      return {
        [sizes?.id ?? "no size type"]: sizes?.options[size]?.id ?? "no such size",
        [menus?.id ?? "no menu type"]: menus?.options[menu]?.id ?? "no such menu",
      };
    };

    const input = (over: Partial<PendingSignupInput> = {}): PendingSignupInput => ({
      memberId,
      productId: product.id,
      choices: picks(0, 0),
      firstChargeCents: 5000,
      weeklyCents: 5000,
      pickupDate: "2027-01-03",
      consentText: "I agree to a weekly charge of $50.",
      consentAt: CONSENT_AT,
      ...over,
    });

    const pending = () => repo.findPendingSignup(memberId, product.id);

    /** Compares option ids whatever order an adapter reads them in. */
    const sorted = (ids: readonly string[] | undefined) => [...(ids ?? [])].sort();

    /** What the rows came to; an empty id here means the write that made them did nothing. */
    const saved = async (over: Partial<PendingSignupInput> = {}): Promise<PendingSignup> => {
      const signup = await repo.savePendingSignup(input(over));
      expect(signup.ledgerId).not.toBe("");
      return signup;
    };

    describe("AC6 — a member's Square customer", () => {
      it("AC6: a new member has none", async () => {
        expect((await repo.findMemberById(memberId))?.squareCustomerId).toBeNull();
      });

      it("AC6: setMemberSquareCustomer stores it, found by id and by email", async () => {
        await repo.setMemberSquareCustomer(memberId, "CUSTOMER_1");
        expect((await repo.findMemberById(memberId))?.squareCustomerId).toBe("CUSTOMER_1");
        expect((await repo.findMemberByEmail("ada@example.com"))?.squareCustomerId).toBe("CUSTOMER_1");
      });

      it("AC6: it stores it on that member and no other", async () => {
        const grace = await repo.createMember({ email: "grace@example.com" });
        await repo.setMemberSquareCustomer(memberId, "CUSTOMER_1");
        expect((await repo.findMemberById(memberId))?.squareCustomerId).toBe("CUSTOMER_1");
        expect((await repo.findMemberById(grace.id))?.squareCustomerId).toBeNull();
      });

      it("AC6: it rolls back with its withActor", async () => {
        const failure = new Error("fn failed after storing the customer");
        await expect(
          repo.withActor({ member: memberId }, async (r) => {
            await r.setMemberSquareCustomer(memberId, "CUSTOMER_1");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect((await repo.findMemberById(memberId))?.squareCustomerId).toBeNull();
      });
    });

    describe("AC7 — the pending rows", () => {
      it("AC7: with none saved, findPendingSignup is null", async () => {
        const grace = await repo.createMember({ email: "grace@example.com" });
        await saved();
        expect(await repo.findPendingSignup(grace.id, product.id)).toBeNull();
        expect(await pending()).not.toBeNull();
      });

      it("AC7: savePendingSignup creates a pending subscription and a pending ledger row, attempt 1, with no card", async () => {
        const signup = await repo.savePendingSignup(input({ choices: picks(1, 1), firstChargeCents: 8000, weeklyCents: 8000 }));
        expect(signup).toMatchObject({
          subscriptionId: expect.stringMatching(UUID),
          ledgerId: expect.stringMatching(UUID),
          ledgerStatus: "pending",
          attempt: 1,
          squareCardId: null,
          amountCents: 8000,
          weeklyCents: 8000,
          pickupDate: "2027-01-03",
        });
        expect(signup.createdAt).toBeInstanceOf(Date);
        expect(sorted(signup.optionIds)).toEqual(sorted(Object.values(picks(1, 1))));
      });

      it("AC7: findPendingSignup reads back what savePendingSignup returned", async () => {
        const signup = await saved();
        const found = await pending();
        expect({ ...found, optionIds: sorted(found?.optionIds) }).toEqual({ ...signup, optionIds: sorted(signup.optionIds) });
      });

      it("AC7: saveSubscriptionCard stores the card on the row", async () => {
        const signup = await saved();
        await repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1");
        expect((await pending())?.squareCardId).toBe("ccof:card-1");
      });

      it("AC7: a save that a withActor rolls back leaves no row", async () => {
        const failure = new Error("fn failed after saving");
        await expect(
          repo.withActor({ member: memberId }, async (r) => {
            expect((await r.savePendingSignup(input())).ledgerId).not.toBe("");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await pending()).toBeNull();
      });

      it("AC7: a save that a withActor commits is there afterwards", async () => {
        await repo.withActor({ member: memberId }, (r) => r.savePendingSignup(input()));
        expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1 });
      });

      it("AC7: a card that a withActor rolls back is not stored", async () => {
        const signup = await saved();
        const failure = new Error("fn failed after saving the card");
        await expect(
          repo.withActor({ member: memberId }, async (r) => {
            await r.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await pending()).toMatchObject({ subscriptionId: signup.subscriptionId, squareCardId: null });
      });
    });

    describe("AC8 — confirming", () => {
      it('AC8: confirmSignupRows returns "confirmed", then "already"', async () => {
        const signup = await saved();
        expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT)).toBe("confirmed");
        expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT)).toBe("already");
      });

      it("AC8: a confirmed signup is active and no longer pending", async () => {
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        expect(await repo.findActiveSubscription(memberId, product.id)).toEqual({ id: signup.subscriptionId });
        expect(await pending()).toBeNull();
      });

      it("AC8: a confirm that a withActor rolls back leaves the signup pending", async () => {
        const signup = await saved();
        const failure = new Error("fn failed after confirming");
        await expect(
          repo.withActor({ member: memberId }, async (r) => {
            expect(await r.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT)).toBe("confirmed");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await repo.findActiveSubscription(memberId, product.id)).toBeNull();
        expect(await pending()).toMatchObject({ subscriptionId: signup.subscriptionId, ledgerStatus: "pending" });
      });
    });

    describe("AC5 — findActiveSubscription", () => {
      it("AC5: a pending signup is not active, and a member with none has none", async () => {
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        const grace = await repo.createMember({ email: "grace@example.com" });
        expect(await repo.findActiveSubscription(memberId, product.id)).toEqual({ id: signup.subscriptionId });
        expect(await repo.findActiveSubscription(grace.id, product.id)).toBeNull();
        await repo.savePendingSignup(input({ memberId: grace.id }));
        expect(await repo.findActiveSubscription(grace.id, product.id)).toBeNull();
      });

      it("AC5: an active subscription to another product does not count", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        expect(await repo.findActiveSubscription(memberId, product.id)).toEqual({ id: signup.subscriptionId });
        expect(await repo.findActiveSubscription(memberId, crate.id)).toBeNull();
      });
    });

    describe("AC9 — a decline, and the next attempt", () => {
      it("AC9: recordSignupDecline moves the ledger row to declined, on attempt 1 still; the subscription stays pending", async () => {
        const signup = await saved();
        await repo.recordSignupDecline(signup.ledgerId);
        expect(await pending()).toMatchObject({ subscriptionId: signup.subscriptionId, ledgerStatus: "declined", attempt: 1 });
        expect(await repo.findActiveSubscription(memberId, product.id)).toBeNull();
      });

      it("AC9: a decline that a withActor rolls back leaves the row pending", async () => {
        const signup = await saved();
        const failure = new Error("fn failed after the decline");
        await expect(
          repo.withActor({ member: memberId }, async (r) => {
            await r.recordSignupDecline(signup.ledgerId);
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await pending()).toMatchObject({ ledgerStatus: "pending" });
      });

      it("AC9: a save after a decline is a new attempt on the same rows: back to pending, attempt 2, the card gone", async () => {
        const first = await saved();
        await repo.saveSubscriptionCard(first.subscriptionId, "ccof:card-1");
        await repo.recordSignupDecline(first.ledgerId);
        const second = await saved();
        expect(second).toMatchObject({
          subscriptionId: first.subscriptionId,
          ledgerId: first.ledgerId,
          ledgerStatus: "pending",
          attempt: 2,
          squareCardId: null,
        });
        expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 2, squareCardId: null });
      });

      it("AC9: it rewrites the options, the amounts and the pickup date from the new submit", async () => {
        const first = await saved();
        await repo.recordSignupDecline(first.ledgerId);
        await saved({ choices: picks(1, 1), firstChargeCents: 8000, weeklyCents: 8000, pickupDate: "2027-01-10" });
        const found = await pending();
        expect(found).toMatchObject({ amountCents: 8000, weeklyCents: 8000, pickupDate: "2027-01-10" });
        expect(sorted(found?.optionIds)).toEqual(sorted(Object.values(picks(1, 1))));
      });

      it("AC10: it leaves createdAt alone, the timestamp the payment lookup starts from", async () => {
        const first = await saved();
        await repo.recordSignupDecline(first.ledgerId);
        const second = await saved({ consentAt: PAID_AT });
        expect(second.createdAt).toEqual(first.createdAt);
      });

      it("AC9: a third attempt after a second decline is attempt 3", async () => {
        const first = await saved();
        await repo.recordSignupDecline(first.ledgerId);
        await saved();
        await repo.recordSignupDecline(first.ledgerId);
        expect((await saved()).attempt).toBe(3);
      });
    });

    describe("AC10a — a resubmit after an error", () => {
      it("AC10a: a save over a pending row rewrites it and keeps the attempt", async () => {
        const first = await saved();
        const second = await saved({ choices: picks(1, 0), firstChargeCents: 8000, weeklyCents: 8000 });
        expect(second).toMatchObject({
          subscriptionId: first.subscriptionId,
          ledgerId: first.ledgerId,
          ledgerStatus: "pending",
          attempt: 1,
          amountCents: 8000,
          weeklyCents: 8000,
        });
        expect(sorted(second.optionIds)).toEqual(sorted(Object.values(picks(1, 0))));
      });
    });

    describe("AC13 — findSignupConfirmation", () => {
      it("AC13: it gives the pickup date, the amounts and each picked option's type and name, in the product's order", async () => {
        const signup = await saved({ choices: picks(1, 1), firstChargeCents: 7000, weeklyCents: 8000 });
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        expect(await repo.findSignupConfirmation(memberId, product.id)).toEqual({
          subscriptionId: signup.subscriptionId,
          pickupDate: "2027-01-03",
          firstDay: "2027-01-03",
          lastDay: "2027-01-04",
          firstChargeCents: 7000,
          weeklyCents: 8000,
          chargedDate: "2026-11-06",
          options: [
            { typeName: "How many people?", optionName: "3–4 people" },
            { typeName: "Which menu?", optionName: "Vegan" },
          ],
          optionsFromWeek: "2027-01-03",
          choices: picks(1, 1),
        });
      });

      it("AC13: a pending signup has no confirmation", async () => {
        const signup = await saved();
        const grace = await repo.createMember({ email: "grace@example.com" });
        await repo.savePendingSignup(input({ memberId: grace.id }));
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        expect(await repo.findSignupConfirmation(memberId, product.id)).not.toBeNull();
        expect(await repo.findSignupConfirmation(grace.id, product.id)).toBeNull();
      });

      it("AC13: a box for another product is not this product's confirmation", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const choices = Object.fromEntries(crate.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"]));
        const signup = await saved({ productId: crate.id, choices });
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        expect(await repo.findSignupConfirmation(memberId, product.id)).toBeNull();
        expect(await repo.findSignupConfirmation(memberId, crate.id)).toMatchObject({ firstChargeCents: 5000 });
      });

      // Issue 101, AC11: the receipt's "Charged {date}" is the day the first charge was paid, on Cleveland's clock.
      it.each([
        ["at 22:30 on November 7 in Cleveland, already November 8 in UTC", "2026-11-08T03:30:00.000Z", "2026-11-07"],
        ["at 23:30 on June 30 in Cleveland, summer time, already July 1 in UTC", "2026-07-01T03:30:00.000Z", "2026-06-30"],
      ])("AC11 (issue 101): chargedDate is the day the first charge was paid, YYYY-MM-DD in Cleveland: paid %s", async (_when, paidAt, chargedDate) => {
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, new Date(paidAt));
        expect((await repo.findSignupConfirmation(memberId, product.id))?.chargedDate).toBe(chargedDate);
      });
    });

    // Issue 133: the weeks an admin changed. BOX's cutoff is Monday, so each moved first_day here is after the
    // Monday before its week, as pickup_weeks requires (db/pickup-weeks.test.ts).
    describe("issue 133 — pickup weeks", () => {
      const CLOSED_AT = new Date("2026-11-01T12:00:00.000Z");
      const closed = (weekOf: string, note: string | null = "Farm closed"): ChangedWeek => ({
        weekOf,
        closedAt: CLOSED_AT,
        note,
        firstDay: null,
        lastDay: null,
      });
      const moved = (weekOf: string, firstDay: string, lastDay: string): ChangedWeek => ({
        weekOf,
        closedAt: null,
        note: "Moved for the holiday",
        firstDay,
        lastDay,
      });

      const confirmed = async () => {
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
      };

      it("AC1: listChangedWeeks reads back a saved week, whole", async () => {
        await repo.savePickupWeek(product.id, closed("2027-01-03"));
        expect(await repo.listChangedWeeks(product.id, "2027-01-03")).toEqual([closed("2027-01-03")]);
      });

      it("AC1: it gives the product's weeks from the date on, ordered by week, and no other product's", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        await repo.savePickupWeek(product.id, closed("2027-01-17"));
        await repo.savePickupWeek(product.id, closed("2026-12-27"));
        await repo.savePickupWeek(product.id, moved("2027-01-10", "2027-01-09", "2027-01-10"));
        await repo.savePickupWeek(product.id, closed("2027-01-03", null));
        await repo.savePickupWeek(crate.id, closed("2027-01-24"));
        expect(await repo.listChangedWeeks(product.id, "2027-01-03")).toEqual([
          closed("2027-01-03", null),
          moved("2027-01-10", "2027-01-09", "2027-01-10"),
          closed("2027-01-17"),
        ]);
      });

      it("AC1: a second save of the same week replaces every column: closedAt null reopens it and note null clears it", async () => {
        await repo.savePickupWeek(product.id, closed("2027-01-03"));
        const reopened: ChangedWeek = { weekOf: "2027-01-03", closedAt: null, note: null, firstDay: "2027-01-02", lastDay: "2027-01-03" };
        await repo.savePickupWeek(product.id, reopened);
        expect(await repo.listChangedWeeks(product.id, "2027-01-03")).toEqual([reopened]);
      });

      it("AC4: a week moved after the signup reads with its moved days; pickupDate stays its Sunday", async () => {
        await confirmed();
        await repo.savePickupWeek(product.id, moved("2027-01-03", "2027-01-02", "2027-01-03"));
        expect(await repo.findSignupConfirmation(memberId, product.id)).toMatchObject({
          pickupDate: "2027-01-03",
          firstDay: "2027-01-02",
          lastDay: "2027-01-03",
        });
      });

      it("AC4: another product's change to the same week does not move this product's", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        await confirmed();
        await repo.savePickupWeek(crate.id, moved("2027-01-03", "2027-01-02", "2027-01-02"));
        expect(await repo.findSignupConfirmation(memberId, product.id)).toMatchObject({ firstDay: "2027-01-03", lastDay: "2027-01-04" });
      });
    });

    describe("AC11 — a row freezes when its card is bound", () => {
      /** A save, however an adapter refuses it: these hold what is stored afterwards. */
      const refused = (over: Partial<PendingSignupInput> = {}) => repo.savePendingSignup(input(over)).catch(() => null);

      it("AC11: a save after the signup is confirmed makes no second row: nothing is pending and the one subscription stays active", async () => {
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        await refused({ choices: picks(1, 0), firstChargeCents: 8000, weeklyCents: 8000 });
        expect(await pending()).toBeNull();
        expect(await repo.findActiveSubscription(memberId, product.id)).toEqual({ id: signup.subscriptionId });
      });

      it("AC11: a save over a pending row with a card rewrites nothing", async () => {
        const first = await saved();
        await repo.saveSubscriptionCard(first.subscriptionId, "ccof:card-1");
        await refused({ choices: picks(1, 1), firstChargeCents: 8000, weeklyCents: 8000, pickupDate: "2027-01-10" });
        const found = await pending();
        expect(found).toMatchObject({
          subscriptionId: first.subscriptionId,
          ledgerId: first.ledgerId,
          attempt: 1,
          squareCardId: "ccof:card-1",
          amountCents: 5000,
          weeklyCents: 5000,
          pickupDate: "2027-01-03",
        });
        expect(sorted(found?.optionIds)).toEqual(sorted(Object.values(picks(0, 0))));
      });

      it("AC11: saveSubscriptionCard returns the amount and the attempt of the row it bound", async () => {
        const signup = await saved({ firstChargeCents: 8000, weeklyCents: 8000 });
        expect(await repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1")).toMatchObject({ amountCents: 8000, attempt: 1 });
      });

      it("AC11: after a decline's rewrite it returns the rewritten amount and the new attempt", async () => {
        const first = await saved();
        await repo.saveSubscriptionCard(first.subscriptionId, "ccof:card-1");
        await repo.recordSignupDecline(first.ledgerId);
        await saved({ firstChargeCents: 8000, weeklyCents: 8000 });
        expect(await repo.saveSubscriptionCard(first.subscriptionId, "ccof:card-2")).toMatchObject({ amountCents: 8000, attempt: 2 });
      });

      it("AC11: a second card does not bind: the first stays, and the loser gets no amount to charge", async () => {
        const signup = await saved();
        await repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1");
        const lost = await repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-2");
        expect((await pending())?.squareCardId).toBe("ccof:card-1");
        expect(lost ?? null).toBeNull();
      });

      it('AC11: confirmSignupRows with an amount that is not the ledger\'s returns "mismatch" and leaves the row pending', async () => {
        const signup = await saved({ firstChargeCents: 8000, weeklyCents: 8000 });
        expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", 7000, PAID_AT)).toBe("mismatch");
        expect(await pending()).toMatchObject({ subscriptionId: signup.subscriptionId, ledgerStatus: "pending", amountCents: 8000 });
        expect(await repo.findActiveSubscription(memberId, product.id)).toBeNull();
      });
    });

    // Issue 57: the cap, on a product of its own so that `BOX` stays at 50 for everything above.
    describe("issue 57 — the cap", () => {
      let others = 0;

      const capped = (cap: number) => addProduct({ ...BOX, name: "Capped", cap });

      const choicesOf = (on: ProductWithOptions) => Object.fromEntries(on.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"]));

      /** The member's pending rows on `on`, with no card: Ada's, or a new member's. */
      const rowsOn = async (on: ProductWithOptions, who?: string): Promise<PendingSignup> =>
        saved({ memberId: who ?? (await repo.createMember({ email: `other-${++others}@example.com` })).id, productId: on.id, choices: choicesOf(on) });

      /** A new member with a card on a pending row and the charge unanswered. */
      const boundOn = async (on: ProductWithOptions): Promise<PendingSignup> => {
        const signup = await rowsOn(on);
        await repo.saveSubscriptionCard(signup.subscriptionId, `ccof:${signup.subscriptionId}`);
        return signup;
      };

      /** A new member with an active subscription. */
      const activeOn = async (on: ProductWithOptions): Promise<PendingSignup> => {
        const signup = await rowsOn(on);
        await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, PAID_AT);
        return signup;
      };

      const adaOn = (on: ProductWithOptions) => repo.findPendingSignup(memberId, on.id);

      describe("AC1 — countHeldSpots", () => {
        it("AC1 (issue 57): an active subscription holds a spot", async () => {
          await activeOn(product);
          expect(await repo.countHeldSpots(product.id)).toBe(1);
        });

        it("AC1 (issue 57): a pending row with a card on it and its ledger row pending holds a spot", async () => {
          await boundOn(product);
          expect(await repo.countHeldSpots(product.id)).toBe(1);
        });

        it("AC1 (issue 57): a pending row with no card holds none, which guards the two above", async () => {
          await rowsOn(product);
          expect(await repo.countHeldSpots(product.id)).toBe(0);
        });

        it("AC1 (issue 57): a row whose ledger row is declined holds none, with its card on it or not, which guards the two above", async () => {
          const carded = await boundOn(product);
          await repo.recordSignupDecline(carded.ledgerId);
          const cardless = await rowsOn(product);
          await repo.recordSignupDecline(cardless.ledgerId);
          expect(await repo.countHeldSpots(product.id)).toBe(0);
        });

        it("AC1 (issue 57): with one of each only the active row and the bound row count", async () => {
          await activeOn(product);
          await boundOn(product);
          await rowsOn(product);
          const declined = await boundOn(product);
          await repo.recordSignupDecline(declined.ledgerId);
          expect(await repo.countHeldSpots(product.id)).toBe(2);
        });

        it("AC1 (issue 57): a spot held on another product does not count here", async () => {
          const crate = await capped(50);
          await activeOn(product);
          await activeOn(crate);
          await boundOn(crate);
          expect(await repo.countHeldSpots(product.id)).toBe(1);
          expect(await repo.countHeldSpots(crate.id)).toBe(2);
        });
      });

      describe("AC7 — the bind refuses at the cap", () => {
        it('AC7 (issue 57): with the cap held, saveSubscriptionCard returns "sold_out" and the row stays cardless and pending', async () => {
          const club = await capped(1);
          await boundOn(club);
          const mine = await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toBe("sold_out");
          expect(await adaOn(club)).toMatchObject({ subscriptionId: mine.subscriptionId, ledgerStatus: "pending", attempt: 1, squareCardId: null });
          expect(await repo.countHeldSpots(club.id)).toBe(1);
        });

        it('AC7 (issue 57): an active subscription fills the cap as a held row does: "sold_out"', async () => {
          const club = await capped(1);
          await activeOn(club);
          const mine = await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toBe("sold_out");
        });

        it('AC7 (issue 57): the last spot binds with its amount and attempt, and the next is "sold_out"', async () => {
          const club = await capped(2);
          await boundOn(club);
          const mine = await rowsOn(club, memberId);
          const last = await rowsOn(club);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toMatchObject({ amountCents: 5000, attempt: 1 });
          expect(await repo.saveSubscriptionCard(last.subscriptionId, "ccof:card-2")).toBe("sold_out");
        });

        it("AC7 (issue 57): a rival's cardless pending row fills nothing, so the bind goes through, which guards the refusals above", async () => {
          const club = await capped(1);
          await rowsOn(club);
          const mine = await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toMatchObject({ amountCents: 5000, attempt: 1 });
        });
      });

      // What the row is outranks the cap: a member's own card must never read as the Supper Club selling out.
      describe("AC7 — the row's own state outranks the cap", () => {
        it('AC7 (issue 57): a row with a card on it returns null at the cap, not "sold_out", and keeps its card', async () => {
          const club = await capped(1);
          const mine = await rowsOn(club, memberId);
          await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1");
          expect((await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-2")) ?? null).toBeNull();
          expect((await adaOn(club))?.squareCardId).toBe("ccof:card-1");
        });

        it('AC7 (issue 57): a row no longer pending returns null at the cap, not "sold_out"', async () => {
          const club = await capped(1);
          const mine = await rowsOn(club, memberId);
          await repo.confirmSignupRows(mine.ledgerId, "PAYMENT_1", mine.amountCents, PAID_AT);
          expect((await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:late")) ?? null).toBeNull();
        });

        it("AC7 (issue 57): a bind refuses a cardless row whose ledger row is declined: null, and the row stays cardless", async () => {
          const mine = await saved();
          await repo.recordSignupDecline(mine.ledgerId);
          expect((await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")) ?? null).toBeNull();
          expect(await pending()).toMatchObject({ ledgerStatus: "declined", squareCardId: null });
        });

        it('AC7 (issue 57): at the cap that row still returns null, not "sold_out"', async () => {
          const club = await capped(1);
          await boundOn(club);
          const mine = await rowsOn(club, memberId);
          await repo.recordSignupDecline(mine.ledgerId);
          expect((await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")) ?? null).toBeNull();
          expect(await adaOn(club)).toMatchObject({ ledgerStatus: "declined", squareCardId: null });
        });
      });

      describe("AC11, AC12 — a decline releases the spot", () => {
        it("AC11 (issue 57): the decline alone takes the count down, and another member can then bind", async () => {
          const club = await capped(1);
          const holder = await boundOn(club);
          const mine = await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toBe("sold_out");
          expect(await repo.countHeldSpots(club.id)).toBe(1);

          await repo.recordSignupDecline(holder.ledgerId);

          expect(await repo.countHeldSpots(club.id)).toBe(0);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toMatchObject({ amountCents: 5000, attempt: 1 });
          expect(await repo.countHeldSpots(club.id)).toBe(1);
        });

        it('AC12 (issue 57): a declined row rewritten for its next attempt meets the cap at the bind: "sold_out", on attempt 2, cardless', async () => {
          const club = await capped(1);
          const mine = await rowsOn(club, memberId);
          await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1");
          await repo.recordSignupDecline(mine.ledgerId);
          await boundOn(club);
          await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-2")).toBe("sold_out");
          expect(await adaOn(club)).toMatchObject({ ledgerStatus: "pending", attempt: 2, squareCardId: null });
        });
      });

      describe("AC14 — a confirm has no cap check", () => {
        it("AC14 (issue 57): rows confirmed past the cap all confirm, and all hold a spot", async () => {
          const club = await capped(1);
          const first = await rowsOn(club);
          const second = await rowsOn(club);
          expect(await repo.confirmSignupRows(first.ledgerId, "PAYMENT_1", first.amountCents, PAID_AT)).toBe("confirmed");
          expect(await repo.confirmSignupRows(second.ledgerId, "PAYMENT_2", second.amountCents, PAID_AT)).toBe("confirmed");
          expect(await repo.countHeldSpots(club.id)).toBe(2);
        });
      });

      // Issue 139: the cap counts only active and held signups (countHeldSpots, unchanged), so a cancel frees a spot.
      describe("AC6 (issue 139) — a cancel releases the spot", () => {
        it("AC6 (issue 139): a product full before a cancel is below its cap after it, and another member's card then binds", async () => {
          const club = await capped(1);
          const holder = await activeOn(club);
          const mine = await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toBe("sold_out");

          expect(await repo.cancelSubscription(holder.subscriptionId, new Date("2026-11-20T15:00:00.000Z"))).toBe(true);

          expect(await repo.countHeldSpots(club.id)).toBe(0);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toMatchObject({ amountCents: 5000, attempt: 1 });
        });
      });
    });

    // Issue 59: the admin's list. Several paid rows on a subscription, and a member's two rows, are Postgres
    // only (src/adapters/postgres-repository.test.ts): the in-memory adapter cannot hold either.
    describe("issue 59 — listSubscribers", () => {
      const ADA: AccountDetails = { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" };

      /** A member's rows on `on`, paid at `paidAt`. */
      const activeOn = async (on: ProductWithOptions, who: string, paidAt = PAID_AT): Promise<PendingSignup> => {
        const choices = Object.fromEntries(on.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"]));
        const signup = await saved({ memberId: who, productId: on.id, choices });
        await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, paidAt);
        return signup;
      };

      const newMember = async (email: string): Promise<string> => (await repo.createMember({ email })).id;

      it("AC3: an active subscription comes back with its member, its options and the date it was paid", async () => {
        await repo.saveAccount(ADA);
        const signup = await saved({ choices: picks(1, 1) });
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);

        expect(await repo.listSubscribers(product.id)).toEqual([
          {
            subscriptionId: signup.subscriptionId,
            firstName: "Ada",
            lastName: "Lovelace",
            email: "ada@example.com",
            phone: "216-555-0100",
            options: [
              { typeName: "How many people?", optionName: "3–4 people" },
              { typeName: "Which menu?", optionName: "Vegan" },
            ],
            joinedDate: "2026-11-06",
            status: "active",
            refundOwed: false,
            cardDeclined: false,
          },
        ]);
      });

      it("AC3: a member with no details reads as nulls, and is listed however their email stands", async () => {
        await activeOn(product, memberId);
        expect(await repo.listSubscribers(product.id)).toEqual([
          expect.objectContaining({ firstName: null, lastName: null, phone: null, email: "ada@example.com" }),
        ]);
      });

      it("AC3: pending rows are left out: with no card, with a card and with a decline", async () => {
        const held = await activeOn(product, memberId);
        await saved({ memberId: await newMember("cardless@example.com") });
        const carded = await saved({ memberId: await newMember("carded@example.com") });
        await repo.saveSubscriptionCard(carded.subscriptionId, "ccof:card-1");
        const declined = await saved({ memberId: await newMember("declined@example.com") });
        await repo.recordSignupDecline(declined.ledgerId);

        expect((await repo.listSubscribers(product.id)).map((row) => row.subscriptionId)).toEqual([held.subscriptionId]);
      });

      it("AC3: another product's subscriptions are left out", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const held = await activeOn(product, memberId);
        await activeOn(crate, await newMember("grace@example.com"));

        expect((await repo.listSubscribers(product.id)).map((row) => row.subscriptionId)).toEqual([held.subscriptionId]);
      });

      it("AC3: options are in option-type position order, not by name", async () => {
        const [sizes, menus] = BOX.optionTypes;
        if (!sizes || !menus) throw new Error("BOX has two option types");
        const reversed = await addProduct({ ...BOX, name: "Reversed", optionTypes: [{ ...menus, position: 1 }, { ...sizes, position: 2 }] });
        await activeOn(reversed, memberId);

        const [row] = await repo.listSubscribers(reversed.id);

        expect(row?.options.map((option) => option.typeName)).toEqual(["Which menu?", "How many people?"]);
      });

      it("AC3: two reads give the rows in the same order", async () => {
        await activeOn(product, memberId);
        await activeOn(product, await newMember("grace@example.com"));
        await activeOn(product, await newMember("linh@example.com"));

        const first = await repo.listSubscribers(product.id);

        expect(first).toHaveLength(3);
        expect(await repo.listSubscribers(product.id)).toEqual(first);
      });

      it.each([
        ["an evening in winter, already tomorrow in UTC", "2026-12-02T03:30:00.000Z", "2026-12-01"],
        ["just after midnight in winter", "2026-12-02T05:30:00.000Z", "2026-12-02"],
        ["an evening in summer, already tomorrow in UTC", "2026-07-02T03:30:00.000Z", "2026-07-01"],
      ])("AC11: a payment on %s is joined on Cleveland's date", async (_what, paidAt, joined) => {
        await activeOn(product, memberId, new Date(paidAt));
        expect((await repo.listSubscribers(product.id))[0]?.joinedDate).toBe(joined);
      });
    });

    // Issue 138: picks are dated sets. A signup writes its one set at its ledger row's week; the account pages and the
    // admin's list read the newest set, whatever week it starts from. Which set a given week reads is the week credit
    // contract's (src/adapters/week-credit-contract.ts), where switchPicks' own rules are too.
    describe("issue 138 — the signup's set, and the newest set", () => {
      const THREE_FOUR_VEGAN = [
        { typeName: "How many people?", optionName: "3–4 people" },
        { typeName: "Which menu?", optionName: "Vegan" },
      ];

      /** Ada's signup for January 3 at the first size and menu, charged. */
      const confirmed = async (): Promise<PendingSignup> => {
        const signup = await saved();
        expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT)).toBe("confirmed");
        return signup;
      };

      it("AC4: a signup saved again for an earlier week writes its picks at that week: its paid week reads them, and they start from it", async () => {
        await saved({ pickupDate: "2027-01-10" });
        const signup = await saved({ pickupDate: "2027-01-03", choices: picks(1, 0) });
        expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT)).toBe("confirmed");
        expect((await repo.listMemberWeeks(signup.subscriptionId)).paid).toEqual([
          {
            weekOf: "2027-01-03",
            amountCents: 5000,
            weekCredit: false,
            options: [
              { typeName: "How many people?", optionName: "3–4 people" },
              { typeName: "Which menu?", optionName: "Standard" },
            ],
          },
        ]);
        expect((await repo.findSignupConfirmation(memberId, product.id))?.optionsFromWeek).toBe("2027-01-03");
      });

      it("AC5: after a switch, findSignupConfirmation gives the newest set, its from_week, its choices and the new weekly price, though the set starts at a week to come", async () => {
        const signup = await confirmed();
        expect(await repo.switchPicks(signup.subscriptionId, picks(1, 1), "2027-01-24", 8000)).toBe("switched");
        expect(await repo.findSignupConfirmation(memberId, product.id)).toMatchObject({
          pickupDate: "2027-01-03",
          weeklyCents: 8000,
          options: THREE_FOUR_VEGAN,
          optionsFromWeek: "2027-01-24",
          choices: picks(1, 1),
        });
      });

      it("AC5: after a switch, listSubscribers gives the subscription's newest set", async () => {
        const signup = await confirmed();
        await repo.switchPicks(signup.subscriptionId, picks(1, 1), "2027-01-24", 8000);
        expect((await repo.listSubscribers(product.id)).map((row) => row.options)).toEqual([THREE_FOUR_VEGAN]);
      });
    });

    // Issue 139: a cancel is a status on the subscription and the time it happened; the ledger is not touched. A second
    // cancel writing nothing, active-and-cancelled in listSubscribers and refundOwed are owned here; the actions test
    // only where they send the member or admin. refundOwed after a week credit is spent is the week credit contract's
    // (src/adapters/week-credit-contract.ts), which has the seam that spends one.
    describe("issue 139 — cancelSubscription, findMemberSubscription and a cancelled subscription", () => {
      const CANCELLED_AT = new Date("2026-11-20T15:00:00.000Z");
      const LATER = new Date("2026-11-27T15:00:00.000Z");
      // BOX's January 3, granted a week credit when closed after it was paid.
      const CLOSED_AT = new Date("2027-01-03T16:00:00.000Z");

      /** A member's signup for January 3, charged: Ada's, or the member given. */
      const confirmed = async (who: string = memberId, on: ProductWithOptions = product): Promise<PendingSignup> => {
        const choices = Object.fromEntries(on.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"]));
        const signup = await saved({ memberId: who, productId: on.id, choices });
        expect(await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, PAID_AT)).toBe("confirmed");
        return signup;
      };

      const newMember = async (email: string): Promise<string> => (await repo.createMember({ email })).id;

      /** The subscription's row in listSubscribers, by id. */
      const listed = async (subscriptionId: string) => (await repo.listSubscribers(product.id)).find((row) => row.subscriptionId === subscriptionId);

      /** A tick of the real clock, so a later row's created_at is later in either adapter. */
      const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

      describe("AC1 — findMemberSubscription and cancelSubscription", () => {
        it("AC1: an active subscription comes back as findSignupConfirmation gives it, with status active and cancelledAt null", async () => {
          await confirmed();
          const confirmation = await repo.findSignupConfirmation(memberId, product.id);
          expect(confirmation).not.toBeNull();
          expect(await repo.findMemberSubscription(memberId, product.id)).toEqual({ ...confirmation, status: "active", cancelledAt: null });
        });

        it("AC1: cancelSubscription on an active subscription is true; it then reads as cancelled, at the time given, its signup details unchanged", async () => {
          const signup = await confirmed();
          const confirmation = await repo.findSignupConfirmation(memberId, product.id);
          expect(await repo.cancelSubscription(signup.subscriptionId, CANCELLED_AT)).toBe(true);
          expect(await repo.findMemberSubscription(memberId, product.id)).toEqual({ ...confirmation, status: "cancelled", cancelledAt: CANCELLED_AT });
        });

        it("AC1: a cancel leaves the ledger as it was: the subscription's paid rows and week credits read the same after it", async () => {
          const signup = await confirmed();
          await repo.closePickupWeek(product.id, "2027-01-03", null, CLOSED_AT);
          const before = await repo.listMemberWeeks(signup.subscriptionId);
          expect(before.weekCredits).toHaveLength(1);
          expect(await repo.cancelSubscription(signup.subscriptionId, CANCELLED_AT)).toBe(true);
          expect(await repo.listMemberWeeks(signup.subscriptionId)).toEqual(before);
        });

        it("AC1: a cancel is that subscription's alone: another member's stays active", async () => {
          const ada = await confirmed();
          const grace = await newMember("grace@example.com");
          await confirmed(grace);
          expect(await repo.cancelSubscription(ada.subscriptionId, CANCELLED_AT)).toBe(true);
          expect(await repo.findMemberSubscription(grace, product.id)).toMatchObject({ status: "active", cancelledAt: null });
        });

        it("AC1: a cancel that its withActor rolls back writes nothing: the subscription stays active", async () => {
          const signup = await confirmed();
          const failure = new Error("fn failed after cancelling");
          await expect(
            repo.withActor({ member: memberId }, async (r) => {
              expect(await r.cancelSubscription(signup.subscriptionId, CANCELLED_AT)).toBe(true);
              throw failure;
            }),
          ).rejects.toBe(failure);
          expect(await repo.findMemberSubscription(memberId, product.id)).toMatchObject({ status: "active", cancelledAt: null });
        });

        it("AC1: findMemberSubscription gives the product asked for: a member subscribed to two products gets each one's", async () => {
          const crate = await addProduct({ ...BOX, name: "Crate" });
          const box = await confirmed();
          const crated = await confirmed(memberId, crate);
          expect((await repo.findMemberSubscription(memberId, product.id))?.subscriptionId).toBe(box.subscriptionId);
          expect((await repo.findMemberSubscription(memberId, crate.id))?.subscriptionId).toBe(crated.subscriptionId);
        });

        it("AC1: a pending signup, with or without a decline, and no subscription at all give null; guards the cases above", async () => {
          const declined = await saved();
          await repo.recordSignupDecline(declined.ledgerId);
          const grace = await newMember("grace@example.com");
          await saved({ memberId: grace });
          expect(await repo.findMemberSubscription(memberId, product.id)).toBeNull();
          expect(await repo.findMemberSubscription(grace, product.id)).toBeNull();
          expect(await repo.findMemberSubscription(await newMember("linh@example.com"), product.id)).toBeNull();
        });
      });

      describe("AC10 — a cancel of a subscription that is not active writes nothing", () => {
        it("AC10: a second cancel is false, and the subscription keeps the first cancel's time", async () => {
          const signup = await confirmed();
          expect(await repo.cancelSubscription(signup.subscriptionId, CANCELLED_AT)).toBe(true);
          expect(await repo.cancelSubscription(signup.subscriptionId, LATER)).toBe(false);
          expect(await repo.findMemberSubscription(memberId, product.id)).toMatchObject({ status: "cancelled", cancelledAt: CANCELLED_AT });
        });

        it("AC10: a pending subscription is false, and stays pending", async () => {
          const signup = await saved();
          expect(await repo.cancelSubscription(signup.subscriptionId, CANCELLED_AT)).toBe(false);
          expect(await pending()).toMatchObject({ subscriptionId: signup.subscriptionId, ledgerStatus: "pending" });
        });

        it("AC10: an unknown id and a string that isn't a UUID are false", async () => {
          await confirmed();
          for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) expect(await repo.cancelSubscription(id, CANCELLED_AT)).toBe(false);
          expect(await repo.findMemberSubscription(memberId, product.id)).toMatchObject({ status: "active" });
        });
      });

      describe("AC7 — signing up again", () => {
        it("AC7: once cancelled, the signup pages' checks do not see the member as subscribed: findActiveSubscription and findSignupConfirmation are null", async () => {
          const signup = await confirmed();
          expect(await repo.cancelSubscription(signup.subscriptionId, CANCELLED_AT)).toBe(true);
          expect(await repo.findActiveSubscription(memberId, product.id)).toBeNull();
          expect(await repo.findSignupConfirmation(memberId, product.id)).toBeNull();
        });

        it("AC7: a member whose subscription is cancelled signs up again as a new subscription; paid, it is the one findMemberSubscription gives, active", async () => {
          const first = await confirmed();
          expect(await repo.cancelSubscription(first.subscriptionId, CANCELLED_AT)).toBe(true);
          await tick();
          const again = await confirmed();
          expect(again.subscriptionId).not.toBe(first.subscriptionId);
          expect(await repo.findMemberSubscription(memberId, product.id)).toMatchObject({ subscriptionId: again.subscriptionId, status: "active", cancelledAt: null });
        });

        it("AC7: while the new signup is still pending, findMemberSubscription gives the cancelled one, which has a paid row", async () => {
          const first = await confirmed();
          expect(await repo.cancelSubscription(first.subscriptionId, CANCELLED_AT)).toBe(true);
          await tick();
          await saved();
          expect(await repo.findMemberSubscription(memberId, product.id)).toMatchObject({ subscriptionId: first.subscriptionId, status: "cancelled" });
        });

        it("AC7: of two cancelled subscriptions, findMemberSubscription gives the newer", async () => {
          const first = await confirmed();
          expect(await repo.cancelSubscription(first.subscriptionId, CANCELLED_AT)).toBe(true);
          await tick();
          const again = await confirmed();
          expect(await repo.cancelSubscription(again.subscriptionId, LATER)).toBe(true);
          expect(await repo.findMemberSubscription(memberId, product.id)).toMatchObject({ subscriptionId: again.subscriptionId, status: "cancelled", cancelledAt: LATER });
        });
      });

      describe("AC9, AC4 — listSubscribers reads active and cancelled subscriptions", () => {
        it("AC9: a cancelled subscription is listed, with status cancelled, beside an active one with status active", async () => {
          const ada = await confirmed();
          const grace = await confirmed(await newMember("grace@example.com"));
          expect(await repo.cancelSubscription(ada.subscriptionId, CANCELLED_AT)).toBe(true);
          const rows = await repo.listSubscribers(product.id);
          expect(Object.fromEntries(rows.map((row) => [row.subscriptionId, row.status]))).toEqual({
            [ada.subscriptionId]: "cancelled",
            [grace.subscriptionId]: "active",
          });
        });

        it("AC4: a cancelled subscription holding an unspent week credit owes a refund", async () => {
          const signup = await confirmed();
          await repo.closePickupWeek(product.id, "2027-01-03", null, CLOSED_AT);
          expect(await repo.cancelSubscription(signup.subscriptionId, CANCELLED_AT)).toBe(true);
          expect(await listed(signup.subscriptionId)).toMatchObject({ status: "cancelled", refundOwed: true });
        });

        it("AC4: a cancelled subscription with no week credit owes none", async () => {
          const signup = await confirmed();
          expect(await repo.cancelSubscription(signup.subscriptionId, CANCELLED_AT)).toBe(true);
          expect(await listed(signup.subscriptionId)).toMatchObject({ status: "cancelled", refundOwed: false });
        });

        it("AC4: an active subscription holding an unspent week credit owes none: it will use it", async () => {
          const signup = await confirmed();
          await repo.closePickupWeek(product.id, "2027-01-03", null, CLOSED_AT);
          expect(await listed(signup.subscriptionId)).toMatchObject({ status: "active", refundOwed: false });
        });
      });
    });
  });
}
