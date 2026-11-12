import { DuplicateEmailError, normalizeEmail, type Member } from "./members.js";
import type { PaymentsPort } from "./ports/payments.js";
import type { Repository } from "./ports/repository.js";
import { hashCode, MAX_ATTEMPTS } from "./sign-in/code.js";

/**
 * Step one of a change of sign-in email (issue 156): a code is minted and hashed, and the pending change is stored
 * for the new address, replacing any the member has. The member's email is untouched. An address another member
 * holds is stored the same, so the code step shows either way; only the send differs, and nothing is sent for it.
 */
export async function requestEmailChange(
  repo: Repository,
  member: Member,
  newEmail: string,
  deps: { now: Date; mintCode: () => string },
): Promise<{ send: "code"; code: string } | { send: "nothing" }> {
  const code = deps.mintCode();
  const address = normalizeEmail(newEmail);
  const holder = await repo.findMemberByEmail(address);
  await repo.startEmailChange({ memberId: member.id, newEmail: address, codeHash: hashCode(code), now: deps.now });
  return holder && holder.id !== member.id ? { send: "nothing" } : { send: "code", code };
}

/** Runs the write in a repository of the caller's choosing, such as `withActor`'s scoped one. */
export type ApplyScope = <T>(run: (repo: Repository) => Promise<T>) => Promise<T>;

/**
 * Step two: the presented code. A guess is claimed first (atomic in the repository), so the sixth guess finds the
 * code dead, the right one included. The code must match and be unexpired, and the address must still be free;
 * only then Square's customer, and last the member. Every refusal but Square's is `invalid`, one value, so the page
 * never says whether an address has an account. A Square refusal leaves the pending change for another try.
 * The sign-in code's wrong-guess window is never touched. `deps.scope` wraps only the final write (default: `repo`).
 */
export async function verifyEmailChange(
  repo: Repository,
  payments: PaymentsPort,
  member: Member,
  code: string,
  deps: { now: Date; scope?: ApplyScope },
): Promise<{ ok: true; from: string; to: string } | { ok: false; reason: "invalid" | "square" }> {
  const invalid = { ok: false, reason: "invalid" } as const;
  const attempts = await repo.countEmailChangeAttempt(member.id);
  if (attempts === 0 || attempts > MAX_ATTEMPTS) return invalid;
  // Read after the claim, so the row compared is the one the claim counted against.
  const change = await repo.findEmailChange(member.id);
  if (!change || hashCode(code) !== change.codeHash) return invalid;
  if (deps.now.getTime() >= change.expiresAt.getTime()) return invalid;
  const holder = await repo.findMemberByEmail(change.newEmail);
  if (holder && holder.id !== member.id) return invalid;
  if (member.squareCustomerId !== null) {
    try {
      await payments.setCustomerEmail({ customerId: member.squareCustomerId, email: change.newEmail });
    } catch {
      return { ok: false, reason: "square" };
    }
  }
  // The claim, the checks and Square's call ran on `repo`; only the write runs in `scope`, so a caller's transaction is
  // not held open across Square. A taken address is caught inside it, an ordinary outcome that leaves the transaction whole.
  const scope: ApplyScope = deps.scope ?? ((run) => run(repo));
  const applied = await scope(async (scoped) => {
    try {
      await scoped.applyEmailChange(member.id, deps.now);
      return true;
    } catch (error) {
      if (error instanceof DuplicateEmailError) return false;
      throw error;
    }
  });
  if (!applied) return invalid;
  return { ok: true, from: member.email, to: change.newEmail };
}
