// Test-only: an InMemoryRepository holding the Supper Club and the rows a signup leaves, for the tests
// of /admin and its spreadsheet. Nothing that ships imports this.
import type { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { PendingSignup } from "@core/ports/repository.js";
import { SUPPER_CLUB_PRODUCT_NAME, type ProductInput, type ProductWithOptions } from "@core/products.js";

export const SIZES: ProductInput["optionTypes"][number] = {
  name: "How many people",
  position: 1,
  options: [
    { name: "3–4 people", priceCents: 8000, position: 1 },
    { name: "2 people", priceCents: 5000, position: 2 },
  ],
};

export const MENUS: ProductInput["optionTypes"][number] = {
  name: "Which menu",
  position: 2,
  options: [
    { name: "Standard", priceCents: 0, position: 1 },
    { name: "Vegan", priceCents: 0, position: 2 },
  ],
};

export function addSupperClub(repo: InMemoryRepository, over: Partial<ProductInput> = {}): ProductWithOptions {
  return repo.addProduct({
    name: SUPPER_CLUB_PRODUCT_NAME,
    cap: 50,
    firstPickupDate: "2027-01-03",
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes: [SIZES, MENUS],
    ...over,
  });
}

export type Person = { email: string; firstName?: string; lastName?: string; phone?: string };

/** One midday in Cleveland, where the joined date is plainly December 1. */
export const DEC_1 = new Date("2026-12-01T17:00:00.000Z");

/** The member's pending rows, picking the options named. A person given no name has no details at all. */
export async function pendingSignup(repo: InMemoryRepository, product: ProductWithOptions, person: Person, picks: string[]): Promise<PendingSignup> {
  const member =
    person.firstName === undefined
      ? await repo.createMember({ email: person.email })
      : await repo.saveAccount({
          email: person.email,
          firstName: person.firstName,
          lastName: person.lastName ?? "",
          phone: person.phone ?? "",
          language: "en",
        });
  return repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(
      product.optionTypes.map((type) => [type.id, type.options.find((option) => picks.includes(option.name))?.id ?? "no such option"]),
    ),
    firstChargeCents: 5000,
    weeklyCents: 5000,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $50.",
    consentAt: DEC_1,
  });
}

/** A member with an active subscription, paid at `paidAt`. */
export async function activeSubscriber(
  repo: InMemoryRepository,
  product: ProductWithOptions,
  person: Person,
  picks: string[],
  paidAt: Date = DEC_1,
): Promise<void> {
  const signup = await pendingSignup(repo, product, person, picks);
  await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, paidAt);
}
