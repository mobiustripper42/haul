import { createHash } from "node:crypto";
import { normalizeEmail } from "./members.js";
import type { Customer, PaymentsPort } from "./ports/payments.js";

/**
 * Spec §7.3's email match on the payments port (issue 54): find the member's Square customer by
 * email, or create one with the email only and the member id as its reference (issue 56). It records
 * nothing; the duplicates are the caller's to log.
 */
export type CustomerMatch = { customerId: string; outcome: "linked" | "created"; duplicates: string[] };

/** Latest `updatedAt` first, a tie to the latest `createdAt`, then the lesser id. */
function byPreference(a: Customer, b: Customer): number {
  return (
    b.updatedAt.getTime() - a.updatedAt.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export async function matchCustomer(
  payments: PaymentsPort,
  input: { email: string; referenceId: string },
): Promise<CustomerMatch> {
  const email = normalizeEmail(input.email);
  const found = await payments.findCustomersByEmail(email);

  const [chosen, ...rest] = [...found].sort(byPreference);
  if (chosen !== undefined) {
    return { customerId: chosen.id, outcome: "linked", duplicates: rest.map((customer) => customer.id) };
  }

  const created = await payments.createCustomer({
    email,
    idempotencyKey: customerIdempotencyKey(email),
    referenceId: input.referenceId,
  });
  return { customerId: created.id, outcome: "created", duplicates: [] };
}

/** The base64url SHA-256 of `text`. */
export function sha256Key(text: string): string {
  return createHash("sha256").update(text).digest("base64url");
}

/**
 * The key a create is sent under: base64url SHA-256 of the normalized email, 43 characters. A signup
 * retried inside Square's search lag gets the same customer back instead of a second one.
 */
export function customerIdempotencyKey(email: string): string {
  return sha256Key(normalizeEmail(email));
}
