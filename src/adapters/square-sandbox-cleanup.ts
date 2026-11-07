/**
 * What `npm run test:square` does about the customers it makes (issue 86). `recordingCustomers` notes
 * each customer a run creates; `deleteSandboxCustomers` deletes them afterwards.
 *
 * Cleanup calls Square itself rather than going through `SquarePayments`, on purpose: the port and the
 * adapter gain nothing that deletes a customer, so production code has no way to do it.
 */
import type { PaymentsPort } from "../ports/payments.js";
import type { FetchLike } from "./resend-email.js";
import { SQUARE_BASE_URLS, SQUARE_TIMEOUT_MS, SQUARE_VERSION } from "./square-payments.js";
import type { squareSandboxSettings } from "./square-sandbox-settings.js";

/**
 * A port that behaves as `payments` does and adds each id `createCustomer` resolves to to `created`.
 * A repeated create with the same key resolves to the same id, so it counts once. Each method is
 * called on `payments` itself, because the real adapter is a class that needs its `this`.
 */
export function recordingCustomers(payments: PaymentsPort, created: Set<string>): PaymentsPort {
  return {
    findCustomersByEmail: (email) => payments.findCustomersByEmail(email),
    createCustomer: async (input) => {
      const customer = await payments.createCustomer(input);
      created.add(customer.id);
      return customer;
    },
    saveCard: (input) => payments.saveCard(input),
    charge: (input) => payments.charge(input),
    setCustomerReference: (input) => payments.setCustomerReference(input),
    findPaymentByReference: (input) => payments.findPaymentByReference(input),
  };
}

/**
 * Deletes `ids` from the sandbox, one at a time. A 404 counts as deleted: the customer is already gone.
 * Any other failure, a rejected request or a timeout included, is counted and cleanup carries on; then
 * it throws naming how many are left. The error gives the count only, never Square's reply.
 */
export async function deleteSandboxCustomers(
  settings: ReturnType<typeof squareSandboxSettings>,
  ids: string[],
  options: { fetch?: FetchLike } = {},
): Promise<void> {
  const send: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  let left = 0;
  for (const id of ids) {
    try {
      const response = await send(`${SQUARE_BASE_URLS.sandbox}/customers/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${settings.accessToken}`, "Square-Version": SQUARE_VERSION },
        signal: AbortSignal.timeout(SQUARE_TIMEOUT_MS),
      });
      if (!response.ok && response.status !== 404) left += 1;
    } catch {
      left += 1;
    }
  }
  if (left > 0) {
    throw new Error(`npm run test:square left ${left} ${left === 1 ? "customer" : "customers"} in the Square sandbox`);
  }
}
