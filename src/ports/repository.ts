import type { AccountDetails } from "../create-account.js";
import type { Language } from "../i18n.js";
import type { Member, Role } from "../members.js";
import type { ProductWithOptions } from "../products.js";
import type { RateLimitRefusal } from "../sign-in/rate-limit.js";
import type { RateLimitStore, SignInStore } from "../sign-in/store.js";

/** The events `audit_log` records beside row changes; the SQL check on `audit_log.event` lists the same. */
export const AUDIT_EVENT_KINDS = [
  "sign_in_by_code",
  "sign_in_by_link",
  "lock",
  "rate_limit_refusal",
  "already_subscribed",
  "square_customer_linked",
  "square_customer_duplicates",
  "card_declined",
  "charge_outcome_unknown",
] as const;
export type AuditEventKind = (typeof AUDIT_EVENT_KINDS)[number];

/**
 * What an event row says beyond its name, written to `audit_log.detail` (DEC-028): `customerIds` on
 * `square_customer_duplicates`, `customerId` on `square_customer_linked`, `ledgerId` on `card_declined`
 * and `charge_outcome_unknown`, and the provider's `code` on `card_declined`. Never a provider's text.
 */
export type AuditEventDetail = { customerId?: string; customerIds?: string[]; ledgerId?: string; code?: string };

export type AuditEvent =
  | { kind: Exclude<AuditEventKind, "rate_limit_refusal">; memberId: string; detail?: AuditEventDetail }
  | ({ kind: "rate_limit_refusal" } & RateLimitRefusal);

/**
 * Who acted: a member, a named system actor, or nobody identified. Stored in `audit_log.actor` as
 * `member:<uuid>` or `system:<name>`, or null.
 */
export type Actor = { member: string } | { system: string } | null;

/** A member's signup in progress: their subscription that is not active yet, with its one ledger row. */
export type PendingSignup = {
  subscriptionId: string;
  ledgerId: string;
  ledgerStatus: "pending" | "paid" | "declined";
  attempt: number;
  squareCardId: string | null;
  amountCents: number;
  weeklyCents: number;
  pickupDate: string;
  createdAt: Date;
  optionIds: string[];
};

export type PendingSignupInput = {
  memberId: string;
  productId: string;
  choices: Record<string, string>;
  firstChargeCents: number;
  weeklyCents: number;
  pickupDate: string;
  consentText: string;
  consentAt: Date;
};

export type SignupConfirmation = {
  pickupDate: string;
  firstChargeCents: number;
  weeklyCents: number;
  options: { typeName: string; optionName: string }[];
};

/**
 * The core's view of stored data (DEC-010). `InMemoryRepository` is the permanent fake and the
 * test substrate; `PostgresRepository` is the real one; one contract suite runs against both.
 *
 * It is also the sign-in store: a sign-in subject is a member, and `member_id` is the subject id.
 */
export interface Repository extends SignInStore, RateLimitStore {
  /**
   * Throws `DuplicateEmailError` when the email, normalized, is already taken. The language defaults
   * to `DEFAULT_LANGUAGE`, the role to `DEFAULT_ROLE`.
   */
  createMember(input: { email: string; language?: Language; role?: Role }): Promise<Member>;
  findMemberByEmail(email: string): Promise<Member | null>;
  /** Null for an unknown id and for a string that isn't a UUID. */
  findMemberById(id: string): Promise<Member | null>;
  saveAccount(input: AccountDetails): Promise<Member>;
  confirmMemberEmail(memberId: string, now: Date): Promise<void>;
  findProductByName(name: string): Promise<ProductWithOptions | null>;
  setMemberSquareCustomer(memberId: string, customerId: string): Promise<void>;
  findActiveSubscription(memberId: string, productId: string): Promise<{ id: string } | null>;
  findPendingSignup(memberId: string, productId: string): Promise<PendingSignup | null>;
  /** Creates the pending rows, or rewrites them on a retry. */
  savePendingSignup(input: PendingSignupInput): Promise<PendingSignup>;
  saveSubscriptionCard(subscriptionId: string, cardId: string): Promise<void>;
  recordSignupDecline(ledgerId: string): Promise<void>;
  confirmSignupRows(ledgerId: string, paymentId: string, now: Date): Promise<"confirmed" | "already">;
  findSignupConfirmation(memberId: string): Promise<SignupConfirmation | null>;
  recordEvent(event: AuditEvent): Promise<void>;
  /**
   * Runs `fn` on a repository scoped to `actor`: one transaction, committed when `fn` resolves and
   * rolled back when it throws. It does not nest.
   */
  withActor<T>(actor: Actor, fn: (repo: Repository) => Promise<T>): Promise<T>;
}
