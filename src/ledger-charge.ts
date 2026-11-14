import type { ChargeResult, PaymentsPort } from "./ports/payments.js";
import type { Actor, Repository } from "./ports/repository.js";

/**
 * What a ledger row's charge is made of, shared by the signup (`src/signup.ts`) and the charge run
 * (`src/charge-run.ts`): one home for the key a row and its attempt make and for the decline write.
 */

/** The decline write: the ledger row to declined, and the event that records it, in one commit. */
export async function recordDecline(repo: Repository, actor: Actor, memberId: string, ledgerId: string, code: string): Promise<void> {
  await repo.withActor(actor, async (scoped) => {
    await scoped.recordSignupDecline(ledgerId);
    await scoped.recordEvent({ kind: "card_declined", memberId, detail: { ledgerId, code } });
  });
}

/**
 * The charge, under the key the ledger row and its attempt make. A throw is Square giving no answer, and
 * the same key goes again once at once: a charge Square took comes back as that payment, not a second one.
 */
export async function sendCharge(
  payments: PaymentsPort,
  { row, cardId, customerId }: { row: { ledgerId: string; attempt: number; amountCents: number }; cardId: string; customerId: string },
): Promise<ChargeResult> {
  const request = {
    customerId,
    cardId,
    amountCents: row.amountCents,
    idempotencyKey: `${row.ledgerId}:${row.attempt}`,
    referenceId: row.ledgerId,
  };
  try {
    return await payments.charge(request);
  } catch {
    return payments.charge(request);
  }
}
