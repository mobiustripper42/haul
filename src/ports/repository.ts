import type { AccountDetails } from "../create-account.js";
import type { Language } from "../i18n.js";
import type { Member, Role } from "../members.js";
import type { ChangedWeek } from "../pickup-week.js";
import type { ProductWithOptions } from "../products.js";
import type { RateLimitRefusal } from "../sign-in/rate-limit.js";
import type { RateLimitStore, SignInStore } from "../sign-in/store.js";

/** The events `audit_log` records beside row changes. A name outside this list is refused by the type alone. */
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
  "sold_out",
] as const;
export type AuditEventKind = (typeof AUDIT_EVENT_KINDS)[number];

/**
 * What an event row says beyond its name, written to `audit_log.detail` (DEC-028): `customerIds` on
 * `square_customer_duplicates`, `customerId` on `square_customer_linked`, `ledgerId` on `card_declined`
 * and `charge_outcome_unknown`, and the provider's `code` on `card_declined`. A charge that did not match its
 * ledger row adds both amounts to `charge_outcome_unknown`. Never a provider's text.
 */
export type AuditEventDetail = {
  customerId?: string;
  customerIds?: string[];
  ledgerId?: string;
  code?: string;
  chargedCents?: number;
  ledgerCents?: number;
};

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

/** `savePendingSignup` refuses a save: the member already holds the box, or a card is bound to the pending row. */
export class SignupRefusedError extends Error {
  constructor() {
    super("The signup cannot be saved over: it is active, or its card is bound");
    this.name = "SignupRefusedError";
  }
}

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

/**
 * `chargedDate` is the day the first charge was paid, `YYYY-MM-DD` in America/New_York. `pickupDate` is the week's
 * Sunday key; `firstDay` and `lastDay` are its days as `pickup_weeks` holds them now.
 */
export type SignupConfirmation = {
  subscriptionId: string;
  pickupDate: string;
  firstDay: string;
  lastDay: string;
  chargedDate: string;
  firstChargeCents: number;
  weeklyCents: number;
  options: { typeName: string; optionName: string }[];
};

/**
 * One active subscription and who holds it, for the admin's list and spreadsheet. `options` is in option-type
 * position order, and `joinedDate` is `YYYY-MM-DD` in America/New_York. A member holding two has two rows (DEC-026).
 */
export type Subscriber = {
  subscriptionId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  options: { typeName: string; optionName: string }[];
  joinedDate: string;
};

/**
 * A week credit (issue 149): a meal of the picks that were charged, granted for the `paid` ledger row
 * `grantedFor` when its week closed, and spent at a later week's charge (`spentOn`, null until then).
 */
export type WeekCredit = {
  id: string;
  subscriptionId: string;
  grantedFor: string;
  spentOn: string | null;
  grantedAt: Date;
  optionIds: string[];
};

/**
 * A subscription's weeks as its account pages read them (issue 155): its `paid` ledger rows, each with the week's
 * Sunday key and the amount charged, its unspent week credits, each with the Sunday key of the ledger row it
 * was granted for, and (issue 137) the Sunday keys of its `skipped` rows.
 */
export type MemberWeeks = {
  paid: { weekOf: string; amountCents: number }[];
  weekCredits: { grantedForWeek: string }[];
  skipped: string[];
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
  /**
   * Creates the pending rows, or rewrites them on a retry. Under a lock on the member row it throws
   * `SignupRefusedError` when the member holds an active subscription to the product, and when the pending
   * row has a card bound with its ledger row pending: that row is frozen.
   */
  savePendingSignup(input: PendingSignupInput): Promise<PendingSignup>;
  /**
   * Binds the card to a pending subscription that has none, and gives back the amount and attempt of its ledger
   * row, which are what to charge. Null when the bind is lost: another card is there, or it is no longer pending,
   * or its ledger row is not pending. Those outrank the cap. Otherwise, under the member row's lock and then the
   * product row's, it counts held spots and returns "sold_out" when the product is full, binding nothing.
   */
  saveSubscriptionCard(subscriptionId: string, cardId: string): Promise<{ amountCents: number; attempt: number } | "sold_out" | null>;
  /**
   * The spots of a product that are taken: an active subscription, or a pending one with a card on it and its
   * ledger row pending. A declined row and a cardless one hold none, so a decline releases its spot with no write.
   */
  countHeldSpots(productId: string): Promise<number>;
  recordSignupDecline(ledgerId: string): Promise<void>;
  /**
   * Flips the rows when `amountCents` is the ledger's `amount_cents`; "mismatch" leaves them pending. A row
   * already paid is "already" whatever the amount, so a replay never reads as a mismatch.
   */
  confirmSignupRows(ledgerId: string, paymentId: string, amountCents: number, now: Date): Promise<"confirmed" | "already" | "mismatch">;
  findSignupConfirmation(memberId: string, productId: string): Promise<SignupConfirmation | null>;
  /** The product's changed weeks with `weekOf >= from`, ordered by `weekOf`. */
  listChangedWeeks(productId: string, from: string): Promise<ChangedWeek[]>;
  /** Saves a week's row: an upsert on product and week that replaces every column. */
  savePickupWeek(productId: string, week: ChangedWeek): Promise<void>;
  /**
   * Closes the week, keeping an existing `closed_at`, saves the note, and grants a week credit per `paid` ledger
   * row of the product for that week, copying the subscription's picks; all under the product row's lock.
   */
  closePickupWeek(productId: string, weekOf: string, note: string | null, now: Date): Promise<void>;
  /** Clears `closed_at` and the note, deletes the week credits granted for the week, and deletes an empty row. */
  reopenPickupWeek(productId: string, weekOf: string): Promise<void>;
  listWeekCredits(productId: string, weekOf: string): Promise<WeekCredit[]>;
  /** Per week key from `from` on, the `paid` ledger rows and the week credits granted. */
  listWeekCounts(productId: string, from: string): Promise<Map<string, { paid: number; weekCredits: number }>>;
  /**
   * The subscription's `paid` ledger rows and its week credits with `spent_on` null, each with the `pickup_date`
   * of the ledger row it was granted for. Empty for an unknown id and for a string that isn't a UUID.
   */
  listMemberWeeks(subscriptionId: string): Promise<MemberWeeks>;
  /**
   * Issue 137: inserts the subscription's `skipped` ledger row for the week (0 cents, attempt 1, no payment). False,
   * writing nothing, when the subscription already has a ledger row for that week. It checks no cutoff.
   */
  skipWeek(subscriptionId: string, weekOf: string): Promise<boolean>;
  /** Issue 137: deletes the subscription's row for the week only when its status is `skipped`; false otherwise. */
  unskipWeek(subscriptionId: string, weekOf: string): Promise<boolean>;
  /** A product's active subscriptions only, unsorted by contract beyond being stable. */
  listSubscribers(productId: string): Promise<Subscriber[]>;
  recordEvent(event: AuditEvent): Promise<void>;
  /**
   * Runs `fn` on a repository scoped to `actor`: one transaction, committed when `fn` resolves and
   * rolled back when it throws. It does not nest.
   */
  withActor<T>(actor: Actor, fn: (repo: Repository) => Promise<T>): Promise<T>;
}
