/**
 * Issue 140: the menu library's repository contract — menus, their texts and the weeks they are on — run against
 * both adapters (DEC-010) by src/adapters/in-memory-product.test.ts and src/adapters/postgres-product.test.ts,
 * which hold the `addProduct` it needs. The repository stores what it is given: what a save may hold is
 * `checkMenu`'s (src/menus.test.ts), and which weeks may take a menu is `assignMenu`'s (app/admin/weeks/actions.test.ts).
 *
 * Not a test file itself: it registers describe/it blocks. `reset`, when given, runs before every test and before `make`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Menu } from "../menus.js";
import { cutoffInstant } from "../pickup-week.js";
import type { Repository } from "../ports/repository.js";
import type { ProductInput, ProductWithOptions } from "../products.js";
import { BOX, UNKNOWN_UUID, UUID } from "./contract-helpers.js";

const typeAt = (at: number) => {
  const type = BOX.optionTypes[at];
  if (!type) throw new Error("BOX has two option types");
  return type;
};
const SIZES = typeAt(0);
const MENUS = typeAt(1);

/** BOX with "Which menu?" marked as the type whose options get a menu text, and "How many people?" stored without the flag. */
const MARKED_BOX: ProductInput = { ...BOX, optionTypes: [SIZES, { ...MENUS, menuTexts: true }] };

const FEB_7 = "2027-02-07";
const FEB_14 = "2027-02-14";
const FEB_21 = "2027-02-21";
const FEB_28 = "2027-02-28";

/** Long enough that two writes never share a timestamp, in Postgres or in the fake. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

export function runMenuContract(
  name: string,
  make: () => Promise<Repository>,
  addProduct: (input: ProductInput) => Promise<ProductWithOptions>,
  reset?: () => Promise<void>,
): void {
  describe(`Menu contract — ${name}`, () => {
    let repo: Repository;
    let product: ProductWithOptions;
    let standard: string;
    let vegan: string;

    beforeEach(async () => {
      if (reset) await reset();
      repo = await make();
      product = await addProduct(MARKED_BOX);
      const options = product.optionTypes.find((type) => type.name === MENUS.name)?.options ?? [];
      standard = options[0]?.id ?? "no standard";
      vegan = options[1]?.id ?? "no vegan";
    });

    const texts = (forStandard: string, forVegan: string) => ({ [standard]: forStandard, [vegan]: forVegan });
    const autumn = () => repo.createMenu({ name: "Autumn harvest", texts: texts("Squash soup\nRye bread", "Lentil soup\nRye bread") });
    const winter = () => repo.createMenu({ name: "Winter roots", texts: texts("Beef stew", "Mushroom stew") });

    it("AC4: findProductByName reads menuTexts true on the marked type, and false on a type stored without it", async () => {
      const found = await repo.findProductByName(MARKED_BOX.name);
      expect(found?.optionTypes.map((type) => [type.name, type.menuTexts])).toEqual([
        [SIZES.name, false],
        [MENUS.name, true],
      ]);
    });

    it("AC4: createMenu returns the menu with a UUID id, its name and its texts keyed by option id, and findMenu reads it back the same", async () => {
      const created = await autumn();
      expect(created).toEqual({ id: expect.stringMatching(UUID), name: "Autumn harvest", texts: texts("Squash soup\nRye bread", "Lentil soup\nRye bread"), updatedAt: expect.any(Date) });
      expect(await repo.findMenu(created.id)).toEqual(created);
    });

    it("AC6: a text is stored as it is given: spaces at a line's end and blank lines between dishes are kept", async () => {
      const created = await repo.createMenu({ name: "Autumn harvest", texts: texts("Squash soup  \n\n\nRye bread", "Lentil soup") });
      expect((await repo.findMenu(created.id))?.texts[standard]).toBe("Squash soup  \n\n\nRye bread");
    });

    it("AC1: with no menus, listMenus is empty", async () => {
      expect(await repo.listMenus()).toEqual([]);
    });

    it("AC1: listMenus is every menu, most recently saved first, and a save moves a menu to the top", async () => {
      const first = await autumn();
      await tick();
      const second = await winter();
      await tick();
      const third = await repo.createMenu({ name: "Spring greens", texts: texts("Pea soup", "Nettle soup") });
      expect((await repo.listMenus()).map((menu) => menu.id)).toEqual([third.id, second.id, first.id]);

      await tick();
      await repo.saveMenu(first.id, { name: "Autumn harvest", texts: texts("Squash soup", "Lentil soup") });
      expect((await repo.listMenus()).map((menu) => menu.id)).toEqual([first.id, third.id, second.id]);
    });

    it("AC1: listMenus gives each menu its name and texts", async () => {
      const created = await autumn();
      expect(await repo.listMenus()).toEqual([created]);
    });

    it("AC5: saveMenu replaces the name and the texts whole, returns the menu as saved, and moves updatedAt on", async () => {
      const created = await autumn();
      await tick();
      const saved = await repo.saveMenu(created.id, { name: "Late autumn", texts: { [standard]: "Pumpkin soup" } });
      expect(saved).toEqual({ id: created.id, name: "Late autumn", texts: { [standard]: "Pumpkin soup" }, updatedAt: expect.any(Date) });
      expect(saved?.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
      expect(await repo.findMenu(created.id)).toEqual(saved);
    });

    it.each([
      ["an unknown id", UNKNOWN_UUID],
      ["a string that isn't a UUID", "not-a-uuid"],
    ])("AC5: saveMenu of %s is null, and writes nothing", async (_what, id) => {
      const created = await autumn();
      expect(await repo.saveMenu(id, { name: "Late autumn", texts: texts("Pumpkin soup", "Bean soup") })).toBeNull();
      expect(await repo.listMenus()).toEqual([created]);
    });

    it.each([
      ["an unknown id", UNKNOWN_UUID],
      ["a string that isn't a UUID", "not-a-uuid"],
    ])("AC5, AC7: findMenu of %s is null", async (_what, id) => {
      await autumn();
      expect(await repo.findMenu(id)).toBeNull();
    });

    describe("AC9 — a week's menu", () => {
      it("AC9: assignWeekMenu puts the menu on the week, and listWeekMenus reads it as week key → menu id", async () => {
        const menu = await autumn();
        expect(await repo.assignWeekMenu(product.id, FEB_14, menu.id)).toBe(true);
        expect(await repo.listWeekMenus(product.id, BOX.firstPickupDate)).toEqual(new Map([[FEB_14, menu.id]]));
      });

      it("AC9: a second assign replaces the week's menu, and null takes it off: no menu is no row", async () => {
        const [first, second] = [await autumn(), await winter()];
        await repo.assignWeekMenu(product.id, FEB_14, first.id);
        await repo.assignWeekMenu(product.id, FEB_14, second.id);
        expect(await repo.listWeekMenus(product.id, BOX.firstPickupDate)).toEqual(new Map([[FEB_14, second.id]]));
        await repo.assignWeekMenu(product.id, FEB_14, null);
        expect(await repo.listWeekMenus(product.id, BOX.firstPickupDate)).toEqual(new Map());
      });

      it("AC9: a menu can be on any number of weeks", async () => {
        const menu = await autumn();
        for (const week of [FEB_14, FEB_21, FEB_28]) await repo.assignWeekMenu(product.id, week, menu.id);
        expect(await repo.listWeekMenus(product.id, BOX.firstPickupDate)).toEqual(
          new Map([
            [FEB_14, menu.id],
            [FEB_21, menu.id],
            [FEB_28, menu.id],
          ]),
        );
      });

      it.each([
        ["an unknown menu", UNKNOWN_UUID],
        ["a menu id that isn't a UUID", "not-a-uuid"],
      ])("AC9: %s is false, and the week keeps the menu it had", async (_what, menuId) => {
        const menu = await autumn();
        await repo.assignWeekMenu(product.id, FEB_14, menu.id);
        expect(await repo.assignWeekMenu(product.id, FEB_14, menuId)).toBe(false);
        expect(await repo.assignWeekMenu(product.id, FEB_21, menuId)).toBe(false);
        expect(await repo.listWeekMenus(product.id, BOX.firstPickupDate)).toEqual(new Map([[FEB_14, menu.id]]));
      });

      it("AC9: listWeekMenus holds the product's weeks from `from` on, and none of another product's", async () => {
        const crate = await addProduct({ ...MARKED_BOX, name: "Crate" });
        const menu = await autumn();
        await repo.assignWeekMenu(product.id, FEB_14, menu.id);
        await repo.assignWeekMenu(product.id, FEB_28, menu.id);
        await repo.assignWeekMenu(crate.id, FEB_21, menu.id);
        expect(await repo.listWeekMenus(product.id, FEB_21)).toEqual(new Map([[FEB_28, menu.id]]));
        expect(await repo.listWeekMenus(crate.id, BOX.firstPickupDate)).toEqual(new Map([[FEB_21, menu.id]]));
      });

      it("AC5: a week holds a reference to the menu: after saveMenu it names the same menu, which reads the new name and texts", async () => {
        const menu = await autumn();
        await repo.assignWeekMenu(product.id, FEB_14, menu.id);
        await repo.saveMenu(menu.id, { name: "Late autumn", texts: texts("Pumpkin soup", "Bean soup") });
        const onWeek = (await repo.listWeekMenus(product.id, BOX.firstPickupDate)).get(FEB_14) ?? "no menu";
        expect(onWeek).toBe(menu.id);
        expect(await repo.findMenu(onWeek)).toMatchObject<Partial<Menu>>({ name: "Late autumn", texts: texts("Pumpkin soup", "Bean soup") });
      });

      // Issue 141: a week's menu as the menu run and the menu page read it, and the stamp that sends its email once.
      it("AC3 (issue 141): findWeekMenu is the week's menu, not yet sent; null for a week with none", async () => {
        const menu = await autumn();
        await repo.assignWeekMenu(product.id, FEB_14, menu.id);
        expect(await repo.findWeekMenu(product.id, FEB_14)).toEqual({ menu, sentAt: null });
        expect(await repo.findWeekMenu(product.id, FEB_21)).toBeNull();
      });

      it("AC3 (issue 141): findWeekMenu reads the menu as it is now, after a save", async () => {
        const menu = await autumn();
        await repo.assignWeekMenu(product.id, FEB_14, menu.id);
        const saved = await repo.saveMenu(menu.id, { name: "Late autumn", texts: texts("Pumpkin soup", "Bean soup") });
        expect((await repo.findWeekMenu(product.id, FEB_14))?.menu).toEqual(saved);
      });

      it("AC3 (issue 141): findWeekMenu holds no other product's week", async () => {
        const crate = await addProduct({ ...MARKED_BOX, name: "Crate" });
        const menu = await autumn();
        await repo.assignWeekMenu(crate.id, FEB_14, menu.id);
        expect(await repo.findWeekMenu(product.id, FEB_14)).toBeNull();
      });

      it("AC3, AC4 (issue 141): markWeekMenuSent stamps the week at now and is true; a second stamp is false and keeps the first", async () => {
        const menu = await autumn();
        await repo.assignWeekMenu(product.id, FEB_14, menu.id);
        const first = new Date("2027-02-11T20:00:00.000Z");
        expect(await repo.markWeekMenuSent(product.id, FEB_14, first)).toBe(true);
        expect(await repo.markWeekMenuSent(product.id, FEB_14, new Date("2027-02-12T20:00:00.000Z"))).toBe(false);
        expect(await repo.findWeekMenu(product.id, FEB_14)).toEqual({ menu, sentAt: first });
      });

      it("AC4 (issue 141): markWeekMenuSent on a week with no menu is false and writes nothing", async () => {
        expect(await repo.markWeekMenuSent(product.id, FEB_14, new Date("2027-02-11T20:00:00.000Z"))).toBe(false);
        expect(await repo.findWeekMenu(product.id, FEB_14)).toBeNull();
        expect(await repo.listWeekMenus(product.id, BOX.firstPickupDate)).toEqual(new Map());
      });

      it("AC4 (issue 141): the stamp survives a change of menu on the week", async () => {
        const [first, second] = [await autumn(), await winter()];
        await repo.assignWeekMenu(product.id, FEB_14, first.id);
        const sentAt = new Date("2027-02-11T20:00:00.000Z");
        await repo.markWeekMenuSent(product.id, FEB_14, sentAt);
        await repo.assignWeekMenu(product.id, FEB_14, second.id);
        expect(await repo.findWeekMenu(product.id, FEB_14)).toEqual({ menu: second, sentAt });
      });

      it("AC4 (issue 141): taking the menu off deletes the stamp with the row, so a menu put on later is not yet sent", async () => {
        const menu = await autumn();
        await repo.assignWeekMenu(product.id, FEB_14, menu.id);
        await repo.markWeekMenuSent(product.id, FEB_14, new Date("2027-02-11T20:00:00.000Z"));
        await repo.assignWeekMenu(product.id, FEB_14, null);
        await repo.assignWeekMenu(product.id, FEB_14, menu.id);
        expect(await repo.findWeekMenu(product.id, FEB_14)).toEqual({ menu, sentAt: null });
      });

      it("AC11: the week's menu is kept through the week closing and reopening", async () => {
        const menu = await autumn();
        await repo.assignWeekMenu(product.id, FEB_14, menu.id);
        await repo.closePickupWeek(product.id, FEB_14, "Kitchen flooded", new Date("2027-02-02T15:00:00.000Z"));
        expect(await repo.listWeekMenus(product.id, BOX.firstPickupDate)).toEqual(new Map([[FEB_14, menu.id]]));
        await repo.reopenPickupWeek(product.id, FEB_14);
        expect(await repo.listChangedWeeks(product.id, FEB_14)).toEqual([]);
        expect(await repo.listWeekMenus(product.id, BOX.firstPickupDate)).toEqual(new Map([[FEB_14, menu.id]]));
      });
    });

    // Issue 141: the boxes a week makes, as the menu email reads them: a `paid` or `declined` ledger row for the week
    // (a declined meal is still made, docs/SPEC.md §7.3), with its member and the picks in effect for the week, the rule
    // `listMemberWeeks` holds (DEC-033, DEC-035), one accepted and one refused case through it here.
    describe("AC3 (issue 141) — listWeekMade", () => {
      const CONSENT_AT = new Date("2027-01-05T15:00:00.000Z");
      const PAID_AT = new Date("2027-01-05T15:00:05.000Z");
      let members = 0;

      /** The option ids at `size` and `menu`, as choices. */
      const choices = (size: number, menu: number): Record<string, string> => {
        const [sizes, menus] = product.optionTypes;
        return {
          [sizes?.id ?? "no size type"]: sizes?.options[size]?.id ?? "no such size",
          [menus?.id ?? "no menu type"]: menus?.options[menu]?.id ?? "no such menu",
        };
      };
      const named = (size: number, menu: number) => [
        { typeName: SIZES.name, optionName: SIZES.options[size]?.name ?? "no such size" },
        { typeName: MENUS.name, optionName: MENUS.options[menu]?.name ?? "no such menu" },
      ];

      /** A new member with a Square customer, and an active subscription with a card, first paid for `firstWeek`. */
      const subscriber = async (firstWeek: string, picks = choices(0, 0)) => {
        await tick();
        const n = ++members;
        const member = await repo.saveAccount({ email: `made-${n}@example.com`, firstName: `Made${n}`, lastName: "Lovelace", phone: "216-555-0100", language: "en" });
        await repo.setMemberSquareCustomer(member.id, `CUSTOMER_${n}`);
        const signup = await repo.savePendingSignup({
          memberId: member.id,
          productId: product.id,
          choices: picks,
          firstChargeCents: 5000,
          weeklyCents: 5000,
          pickupDate: firstWeek,
          consentText: "I agree to a weekly charge of $50.",
          consentAt: CONSENT_AT,
        });
        expect(await repo.saveSubscriptionCard(signup.subscriptionId, `ccof:made-${n}`)).toEqual({ amountCents: 5000, attempt: 1 });
        expect(await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, 5000, PAID_AT)).toBe("confirmed");
        const stored = await repo.findMemberById(member.id);
        if (!stored) throw new Error("the member just saved is gone");
        return { member: stored, subscriptionId: signup.subscriptionId };
      };

      /** The week's pending row for the subscription, written the way the charge run writes it. */
      const enrolled = async (subscriptionId: string, week: string): Promise<string> => {
        const row = (await repo.listPendingCharges(product.id)).find((pending) => pending.subscriptionId === subscriptionId && pending.pickupDate === week);
        if (!row) throw new Error(`no pending row for ${week}`);
        return row.ledgerId;
      };

      it("AC3: a paid row and a declined row for the week are made, each with its member and picks, in subscription creation order; a pending row and a skipped row are not", async () => {
        const paid = await subscriber(FEB_7);
        const declined = await subscriber(FEB_7, choices(1, 1));
        const pending = await subscriber(FEB_7);
        const skipped = await subscriber(FEB_7);
        expect(await repo.skipWeek(skipped.subscriptionId, FEB_14)).toBe(true);
        await repo.enrolWeek(product.id, FEB_14, cutoffInstant(product, FEB_14));
        expect(await repo.confirmSignupRows(await enrolled(paid.subscriptionId, FEB_14), "PAYMENT_PAID", 5000, PAID_AT)).toBe("confirmed");
        expect(await repo.recordSignupDecline(await enrolled(declined.subscriptionId, FEB_14))).toBe(true);
        await enrolled(pending.subscriptionId, FEB_14);

        expect(await repo.listWeekMade(product.id, FEB_14)).toEqual([
          { subscriptionId: paid.subscriptionId, member: paid.member, options: named(0, 0) },
          { subscriptionId: declined.subscriptionId, member: declined.member, options: named(1, 1) },
        ]);
      });

      it("AC3: a first week paid at signup is made that week; another week's rows and another product's are not", async () => {
        const crate = await addProduct({ ...MARKED_BOX, name: "Crate" });
        const first = await subscriber(FEB_14);
        await subscriber(FEB_21);
        const n = ++members;
        const other = await repo.createMember({ email: `crate-${n}@example.com` });
        const crateSignup = await repo.savePendingSignup({
          memberId: other.id,
          productId: crate.id,
          choices: Object.fromEntries(crate.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
          firstChargeCents: 5000,
          weeklyCents: 5000,
          pickupDate: FEB_14,
          consentText: "I agree to a weekly charge of $50.",
          consentAt: CONSENT_AT,
        });
        expect(await repo.confirmSignupRows(crateSignup.ledgerId, `PAYMENT_${crateSignup.ledgerId}`, 5000, PAID_AT)).toBe("confirmed");

        expect((await repo.listWeekMade(product.id, FEB_14)).map((made) => made.subscriptionId)).toEqual([first.subscriptionId]);
      });

      it("AC3: the picks are those in effect for the week: a switch from the week after leaves the week's picks as they were", async () => {
        const ada = await subscriber(FEB_14);
        expect(await repo.switchPicks(ada.subscriptionId, choices(1, 1), FEB_21, 8000)).toBe("switched");
        expect((await repo.listWeekMade(product.id, FEB_14)).map((made) => made.options)).toEqual([named(0, 0)]);
      });

      it("AC3 (DEC-035): a row a week credit paid shows the week credit's picks, not the set switched to since", async () => {
        const ada = await subscriber(FEB_7);
        expect(await repo.closePickupWeek(product.id, FEB_7, null, new Date("2027-02-02T15:00:00.000Z"))).toBe(true);
        expect(await repo.switchPicks(ada.subscriptionId, choices(1, 1), FEB_14, 8000)).toBe("switched");
        expect((await repo.enrolWeek(product.id, FEB_14, cutoffInstant(product, FEB_14))).byWeekCredit).toHaveLength(1);
        expect((await repo.listWeekMade(product.id, FEB_14)).map((made) => made.options)).toEqual([named(0, 0)]);
      });
    });
  });
}
