/**
 * `npm run square:seed`: the Square customers AC15's by-hand checks need, made in Square's sandbox through
 * `SquarePayments`. One customer for `linked@example.com` and two for `duplicates@example.com`, the emails of the
 * members AC15 signs up as, so a signup meets an existing customer and several (issue 56).
 *
 * It writes to Square, not to the database, so it lives beside the seeds and not in them; it is by hand,
 * never in `verify` or CI, like `npm run test:square`, and it leaves customers in the sandbox account.
 * Re-runnable: it searches first and creates only what is missing, under keys that are the same on every
 * run, so a re-run inside Square's search lag (a create can take up to a minute to show) gets the customer
 * it made back and does not make another.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256Key } from "../src/customer-match.js";
import { errorFields } from "../src/record-event.js";
import type { PaymentsPort } from "../src/ports/payments.js";
import { SquarePayments } from "../src/adapters/square-payments.js";
import { squareSandboxSettings } from "../src/adapters/square-sandbox-settings.js";

/** How many Square customers each email should have. */
export const SANDBOX_CUSTOMERS: ReadonlyArray<{ email: string; count: number }> = [
  { email: "linked@example.com", count: 1 },
  { email: "duplicates@example.com", count: 2 },
];

/** Makes up to `count` customers for each email, and says how many it found and how many it made. */
export async function seedSandboxCustomers(
  payments: PaymentsPort,
  wanted: ReadonlyArray<{ email: string; count: number }> = SANDBOX_CUSTOMERS,
): Promise<Array<{ email: string; found: number; created: number }>> {
  const done: Array<{ email: string; found: number; created: number }> = [];
  for (const { email, count } of wanted) {
    const found = (await payments.findCustomersByEmail(email)).length;
    let created = 0;
    for (let ordinal = found + 1; ordinal <= count; ordinal++) {
      await payments.createCustomer({ email, idempotencyKey: sha256Key(`square-sandbox-customers:${email}:${ordinal}`) });
      created += 1;
    }
    done.push({ email, found, created });
  }
  return done;
}

// CLI: `tsx db/square-sandbox-customers.ts`. The sandbox's own variables, as `npm run test:square` reads them.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  seedSandboxCustomers(new SquarePayments(squareSandboxSettings(process.env)))
    .then((done) => {
      for (const { email, found, created } of done) console.log(`${email}: ${found} found, ${created} created.`);
    })
    .catch((e: unknown) => {
      // Its name and code, not its message: a Square error's message carries the reply.
      console.error("square:seed failed", errorFields(e));
      process.exit(1);
    });
}
