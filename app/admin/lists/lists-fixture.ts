// Test-only: the weeks and members the weekly lists' tests read, in an InMemoryRepository holding the Supper Club
// (../subscribers-fixture). Nothing that ships imports this.
import type { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Role } from "@core/members.js";
import { cutoffInstant } from "@core/pickup-week.js";
import type { PendingSignup } from "@core/ports/repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import type { RequestState } from "../../next-headers-fake";

/**
 * Wednesday, February 3, 2027, noon in Cleveland. The first upcoming week is February 7, its cutoff (the end of
 * Monday, February 1) passed and its pickup to come; February 14's cutoff, the end of Monday, February 8, is to come.
 */
export const NOW = new Date("2027-02-03T17:00:00.000Z");
export const FEB_7 = "2027-02-07";
export const FEB_14 = "2027-02-14";
/** NOW's date as the print page words it. */
export const TODAY = "Wednesday, February 3";

export type Person = { email: string; firstName: string; lastName: string; phone: string };

export const ROSA: Person = { email: "rosa@example.com", firstName: "Rosa", lastName: "Bennett", phone: "216-555-0187" };
export const CHIDI: Person = { email: "chidi@example.com", firstName: "Chidi", lastName: "Abara", phone: "216-555-0142" };
export const MARCO: Person = { email: "marco@example.com", firstName: "Marco", lastName: "Castillo", phone: "440-555-0123" };
export const LAN: Person = { email: "lan@example.com", firstName: "Lan", lastName: "Nguyen", phone: "216-555-0101" };
export const TAM: Person = { email: "tam@example.com", firstName: "Tam", lastName: "Okafor", phone: "216-555-0199" };

/** `person`'s active subscription picking the options named, its first week `firstWeek`, paid at signup. */
export async function subscribe(repo: InMemoryRepository, product: ProductWithOptions, person: Person, picks: string[], firstWeek = "2027-01-10"): Promise<PendingSignup> {
  const member = await repo.saveAccount({ ...person, language: "en" });
  const signup = await repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options.find((option) => picks.includes(option.name))?.id ?? "no such option"])),
    firstChargeCents: 8000,
    weeklyCents: 8000,
    pickupDate: firstWeek,
    consentText: "I agree to a weekly charge of $80.",
    consentAt: new Date("2027-01-05T15:00:00.000Z"),
  });
  await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, new Date("2027-01-05T15:00:05.000Z"));
  return signup;
}

/**
 * Four members due both weeks, with no rows for either: Rosa and Chidi at 3–4 people, Standard; Marco at 2 people,
 * Vegan; Lan at 2 people, Standard, who skips February 14. February 7's lists are four meals; February 14's three meals
 * and Lan's skip.
 */
export async function fourMembers(repo: InMemoryRepository, product: ProductWithOptions): Promise<Record<"rosa" | "chidi" | "marco" | "lan", PendingSignup>> {
  const rosa = await subscribe(repo, product, ROSA, ["3–4 people", "Standard"]);
  const chidi = await subscribe(repo, product, CHIDI, ["3–4 people", "Standard"]);
  const marco = await subscribe(repo, product, MARCO, ["2 people", "Vegan"]);
  const lan = await subscribe(repo, product, LAN, ["2 people", "Standard"]);
  if (!(await repo.skipWeek(lan.subscriptionId, FEB_14))) throw new Error("Lan's skip of February 14 was refused");
  return { rosa, chidi, marco, lan };
}

/**
 * One of each for February 7: Rosa's meal paid by the week credit January 31's closing granted her, and Lan's skip,
 * Lan then cancelling, so Rosa is the one active member.
 */
export async function oneOfEach(repo: InMemoryRepository, product: ProductWithOptions): Promise<void> {
  await subscribe(repo, product, ROSA, ["3–4 people", "Standard"], "2027-01-31");
  await repo.closePickupWeek(product.id, "2027-01-31", null, new Date("2027-01-20T15:00:00.000Z"));
  const lan = await subscribe(repo, product, LAN, ["2 people", "Standard"]);
  if (!(await repo.skipWeek(lan.subscriptionId, FEB_7))) throw new Error("Lan's skip of February 7 was refused");
  await repo.cancelSubscription(lan.subscriptionId, NOW);
  const enrolled = await repo.enrolWeek(product.id, FEB_7, cutoffInstant(product, FEB_7));
  if (enrolled.byWeekCredit.length !== 1) throw new Error("February 7 did not spend Rosa's week credit");
}

/** Signs the request in as a new member in `role`. */
export async function signInAs(repo: InMemoryRepository, request: RequestState, secret: string, role: Role): Promise<void> {
  const member = await repo.createMember({ email: "lenny@example.com", role });
  request.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(NOW.getTime() + 24 * 60 * 60_000).toISOString() }, secret);
}

/** Each `<tr>` of `markup`'s tables, as the text of its cells, header and data cells alike. */
export function tableRows(markup: string): string[][] {
  const text = (inner: string) => inner.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return [...markup.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row = ""]) => [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell = ""]) => text(cell)));
}

/** Each `<a>` of `markup` whose text is `label`, as its path and its query. */
export function linksLabelled(markup: string, label: string): { path: string; query: Record<string, string> }[] {
  return [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter(([, , inner = ""]) => inner.replace(/<[^>]*>/g, "").trim() === label)
    .map(([, attrs = ""]) => {
      const url = new URL(/\bhref="([^"]*)"/.exec(attrs)?.[1] ?? "", "http://haul.test/");
      return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
    });
}
