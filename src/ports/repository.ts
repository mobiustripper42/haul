import type { AccountDetails } from "../create-account.js";
import type { Language } from "../i18n.js";
import type { Member, Role } from "../members.js";
import type { Menu, MenuInput } from "../menus.js";
import type { ChangedWeek } from "../pickup-week.js";
import type { Card } from "./payments.js";
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
  // Issue 156: the event kind the interface names. Which entry records it is the task's (AUDIT_ENTRY_POINTS).
  "email_changed",
  // Issue 141: the missing-menu email's event; the menu run's route records it (AUDIT_ENTRY_POINTS).
  "menu_reminder_sent",
  // Issue 231: the missing-note email's event, recorded by the same route.
  "note_reminder_sent",
  // Issue 254: a payment that succeeded whose card could not be saved from it (DEC-053).
  "card_not_saved",
] as const;
export type AuditEventKind = (typeof AUDIT_EVENT_KINDS)[number];

/**
 * What an event row says beyond its name, written to `audit_log.detail` (DEC-028): `customerIds` on
 * `square_customer_duplicates`, `customerId` on `square_customer_linked`, `ledgerId` on `card_declined`
 * and `charge_outcome_unknown`, and the provider's `code` on `card_declined`, and on `charge_outcome_unknown` when the
 * error that left the outcome unknown was a `PaymentsError`. A charge that did not match its ledger row adds both
 * amounts to `charge_outcome_unknown`. `card_not_saved` (issue 254) holds `ledgerId`, `paymentId` and, for a
 * `PaymentsError`, its `code`. Never a provider's text.
 */
export type AuditEventDetail = {
  customerId?: string;
  customerIds?: string[];
  ledgerId?: string;
  paymentId?: string;
  code?: string;
  chargedCents?: number;
  ledgerCents?: number;
  from?: string;
  to?: string;
  // Issue 141: the weeks a missing-menu email named, ascending, and the run's Cleveland date it went out on.
  weeks?: string[];
  date?: string;
};

/** Issue 141: a box a week makes: a `paid` or `declined` ledger row, its member and the picks in effect for the week. */
export type WeekMade = { subscriptionId: string; member: Member; options: { typeName: string; optionName: string }[] };

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
  /** When the charge that has no answer yet was sent, null when none is out (DEC-053). */
  chargeSentAt: Date | null;
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
  /** Issue 138: the `from_week` of the newest set of picks, `YYYY-MM-DD`; `options` is that set. */
  optionsFromWeek: string;
  /** Issue 138: the newest set of picks, option type id → option id. */
  choices: Record<string, string>;
};

/**
 * Issue 139: the member's subscription as the account pages read it, active or cancelled. `status` is the one home
 * for "is it cancelled"; `cancelledAt` is null while it is active.
 */
export type MemberSubscription = SignupConfirmation & { status: "active" | "cancelled"; cancelledAt: Date | null; declinedWeek: string | null;
  /** Active, not comped, and no card on file (`square_card_id` null): the member owes a card. */
  needsCard: boolean;
};

/**
 * One active or cancelled subscription and who holds it, for the admin's list and spreadsheet. `options` is in
 * option-type position order, and `joinedDate` is `YYYY-MM-DD` in America/New_York. A member holding two has two rows
 * (DEC-026). `refundOwed` (issue 139) is a cancelled subscription holding a week credit not yet spent: the farm
 * refunds it by hand in Square (DEC-005).
 */
export type Subscriber = {
  subscriptionId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  options: { typeName: string; optionName: string }[];
  joinedDate: string;
  status: "active" | "cancelled";
  refundOwed: boolean;
  cardDeclined: boolean;
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
 * Issue 151: a subscription due a week, as closing it reads them to email each member (docs/SPEC.md §7.2): `weekCredit`
 * for a `paid` row for the week, whatever the subscription's status; `noCharge` for an active subscription whose first
 * paid week is on or before it, with no `paid` or `skipped` row for it.
 */
export type WeekDue = { subscriptionId: string; member: Member; notice: "weekCredit" | "noCharge" };

/**
 * A subscription's weeks as its account pages read them (issue 155): its `paid` ledger rows, each with the week's
 * Sunday key and the amount charged, its unspent week credits, each with the Sunday key of the ledger row it
 * was granted for, and (issue 137) the Sunday keys of its `skipped` rows.
 */
export type MemberWeeks = {
  /**
   * Issue 138: `options` is the set of picks in effect for the week, in option-type position order. Issue 150:
   * `weekCredit` is whether a week credit paid the row.
   */
  paid: { weekOf: string; amountCents: number; weekCredit: boolean; options: { typeName: string; optionName: string }[] }[];
  weekCredits: { grantedForWeek: string }[];
  skipped: string[];
  /** Issue 198: the pickup date of each `locked` ledger row, in date order. */
  locked: string[];
  /** Issue 198: the pickup date of each `declined` ledger row, in date order. */
  declined: string[];
};

/**
 * Issue 134: a `pending` ledger row whose subscription has a card or whose charge is out, as the charge run settles it.
 * `cardId` is null for a subscription with no card on file (issue 254): the run declines such a row `NO_CARD`. `createdAt` is the
 * subscription's, for a lookup's `since`; `closed` is whether the row's week is closed; `lastPickupDay` is the week's
 * last pickup day, the moved one for a moved week, `YYYY-MM-DD`.
 */
export type PendingCharge = {
  ledgerId: string;
  subscriptionId: string;
  subscriptionStatus: "pending" | "active" | "cancelled";
  memberId: string;
  customerId: string;
  cardId: string | null;
  /** When the charge that has no answer yet was sent, null when none is out. */
  chargeSentAt: Date | null;
  amountCents: number;
  attempt: number;
  pickupDate: string;
  createdAt: Date;
  closed: boolean;
  lastPickupDay: string;
};

/**
 * Issue 145: a subscription's `declined` ledger row, as a card update retries it. `closed` is whether the row's week is
 * closed: such a row is never retried, and a save that puts a new card on file deletes it.
 */
export type DeclinedCharge = { ledgerId: string; pickupDate: string; amountCents: number; attempt: number; closed: boolean };

/**
 * Issue 145, issue 254: what `claimCardUpdate` decided. `claimed`: the open declined row has its charge marked sent and a
 * bumped attempt, and stays declined, to charge; `out`: a charge is already out, on `charge`, nothing written; `busy`: a
 * pending row waits on the card on file, nothing written; `nothing_owed`: no open week is owed, nothing written;
 * `inactive`: the subscription is not active, nothing written.
 */
export type CardUpdateClaim =
  | { kind: "inactive" }
  | { kind: "out"; charge: PendingCharge }
  | { kind: "busy" }
  | { kind: "claimed"; charge: PendingCharge }
  | { kind: "nothing_owed" };

/**
 * Issue 150: what `enrolWeek` wrote: `pending` rows to charge, rows paid at 0 cents for a 0-cent set (`zeroCents`), and
 * the rows a week credit paid (`byWeekCredit`), each with its member, for the run's receipts.
 */
export type EnrolledWeek = {
  pending: number;
  zeroCents: number;
  byWeekCredit: { ledgerId: string; memberId: string }[];
  locked: { ledgerId: string; memberId: string }[];
};

/**
 * Issue 142: a subscription on a week's lists and who holds it. `options` is its picks for the week, in option-type
 * position order.
 */
export type WeekMember = {
  subscriptionId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  options: { typeName: string; optionName: string }[];
};

/** Issue 142: a meal the week makes: whether a week credit paid it, and whether its card was declined. */
export type WeekBox = WeekMember & { weekCredit: boolean; cardDeclined: boolean };

/** Issue 142: a week's meals and its skips. */
export type WeekBoxes = { boxes: WeekBox[]; skips: WeekMember[] };

/** Issue 156: a member's email change waiting for its code, one per member. */
export type EmailChange = { memberId: string; newEmail: string; codeHash: string; expiresAt: Date; attempts: number };

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
  /** Issue 156: the member's name, phone and language; the email is left alone. */
  saveMemberDetails(memberId: string, details: { firstName: string; lastName: string; phone: string; language: Language; menuEmails: boolean }): Promise<Member>;
  /** Issue 156: `expires_at = now + CODE_TTL_MS`, `attempts = 0`, replacing any row the member has. */
  startEmailChange(input: { memberId: string; newEmail: string; codeHash: string; now: Date }): Promise<void>;
  /** Issue 156: the member's row, even once expired; the caller compares `expiresAt`. Null when none. */
  findEmailChange(memberId: string): Promise<EmailChange | null>;
  /** Issue 156: adds one to `attempts` and returns the new count; 0 when no row exists. */
  countEmailChangeAttempt(memberId: string): Promise<number>;
  /** Issue 156: the new address becomes the member's email, `email_confirmed_at = now`, and the row is deleted. */
  applyEmailChange(memberId: string, now: Date): Promise<Member>;
  dropEmailChange(memberId: string): Promise<void>;
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
   * Marks the charge out (`ledger.charge_sent_at` = `now`) on a pending subscription's ledger row that has none, and gives
   * back the amount and attempt of that row, which are what to charge. The charge is out from here. Null when the start is
   * lost: a charge is already out, or the subscription is no longer pending, or its ledger row is not pending. Those outrank
   * the cap. Otherwise, under the member row's lock and then the product row's, it counts held spots and returns "sold_out"
   * when the product is full, writing nothing.
   */
  startSignupCharge(subscriptionId: string, now: Date): Promise<{ amountCents: number; attempt: number } | "sold_out" | null>;
  /**
   * The end of a refused charge: clears `charge_sent_at` of a row whose charge is out, when it is still `sentAt`, the stamp
   * of the charge that ended. A signup's `pending` row stays `pending` with its attempt bumped (the next card is a new
   * request under a new key); a card update's `declined` one stays `declined` at its attempt. Null, writing nothing, when
   * the row has no charge out or another charge's stamp.
   */
  abandonCharge(ledgerId: string, sentAt: Date): Promise<"pending" | "declined" | null>;
  /**
   * A submit takes over the charge that is out: on a row out at `attempt` with the stamp `expected`, sets the stamp to the
   * later of `now` and `expected` + 1 ms (two submits never hold one stamp) and gives back what it wrote. Null, writing
   * nothing, on any other row.
   */
  markChargeSent(ledgerId: string, attempt: number, expected: Date, now: Date): Promise<Date | null>;
  /**
   * The next key: on a row out at `attempt` with the stamp `expected`, the attempt one higher and the stamp the later of
   * `now` and `expected` + 1 ms. Null, writing nothing, on any other row.
   */
  restartCharge(ledgerId: string, attempt: number, expected: Date, now: Date): Promise<{ attempt: number; sentAt: Date } | null>;
  /** Puts `previous` back as the stamp of a row out at `attempt` with the stamp `expected`; false, writing nothing, on any other row. */
  restoreChargeSent(ledgerId: string, attempt: number, expected: Date, previous: Date): Promise<boolean>;
  /**
   * The card update with nothing owed, under the member row's lock: `inactive` when the subscription is not `active`,
   * `busy` when it holds a `pending` row and has a card on file, or any row whose charge is out, both writing nothing (a
   * `pending` row with no charge out on a subscription with no card does not: the card saved is the one its charge uses); else sets the card's id, brand
   * and last four and deletes the closed weeks' `declined` rows with no charge out, as `replaced`.
   */
  replaceSubscriptionCard(subscriptionId: string, card: Card): Promise<"replaced" | "busy" | "inactive">;
  /**
   * The spots of a product that are taken: an active subscription, or a pending one whose ledger row is pending with a
   * charge out (`charge_sent_at` set). A declined row and one with no charge out hold none, so a decline releases its spot with no write.
   */
  countHeldSpots(productId: string): Promise<number>;
  /**
   * Ends a ledger row that is `pending`, or `declined` with its charge out (a card update's), as `declined` with no charge out. True
   * only when this call made that change; false when the row was paid, already declined with no charge out (another firing's), or
   * does not exist, so only the writer that did it acts on the decline. With `attempt`, only a row at that attempt: a
   * decline that comes back once a newer charge is out ends nothing.
   */
  recordSignupDecline(ledgerId: string, attempt?: number): Promise<boolean>;
  /**
   * Flips the rows when `amountCents` is the ledger's `amount_cents`, clearing `charge_sent_at`; "mismatch" leaves them as they are.
   * A row already paid is "already" whatever the amount, so a replay never reads as a mismatch. With `card`, the same
   * transaction sets the subscription's card id, brand and last four and deletes its closed weeks' `declined` rows that have
   * no charge out; with none, a `declined` row whose charge was out sets those three columns null (a card update paid whose card
   * could not be saved). "mismatch" and "already" write no card.
   */
  confirmSignupRows(ledgerId: string, paymentId: string, amountCents: number, now: Date, card?: Card): Promise<"confirmed" | "already" | "mismatch">;
  findSignupConfirmation(memberId: string, productId: string): Promise<SignupConfirmation | null>;
  /**
   * Issue 139: the member's newest subscription to the product that is `active` or `cancelled` and has a paid ledger
   * row; null when there is none.
   */
  findMemberSubscription(memberId: string, productId: string): Promise<MemberSubscription | null>;
  /**
   * Issue 139: sets `status = 'cancelled'` and `cancelled_at = now`. False, writing nothing, when the subscription is
   * not `active`, an unknown id and a string that isn't a UUID included. The ledger is not touched.
   */
  cancelSubscription(subscriptionId: string, now: Date): Promise<boolean>;
  /** The product's changed weeks with `weekOf >= from`, ordered by `weekOf`. */
  listChangedWeeks(productId: string, from: string): Promise<ChangedWeek[]>;
  /** Saves a week's row: an upsert on product and week that replaces every column. */
  savePickupWeek(productId: string, week: ChangedWeek): Promise<void>;
  /**
   * Closes the week, keeping an existing `closed_at`, saves the note, and grants a week credit per `paid` ledger
   * row of the product for that week, copying the subscription's picks; all under the product row's lock. True when
   * this call closed the week (no row, or a row whose `closed_at` is null), false when it was already closed.
   */
  closePickupWeek(productId: string, weekOf: string, note: string | null, now: Date): Promise<boolean>;
  /** Clears `closed_at` and the note, deletes the week credits granted for the week, and deletes an empty row. */
  reopenPickupWeek(productId: string, weekOf: string): Promise<void>;
  listWeekCredits(productId: string, weekOf: string): Promise<WeekCredit[]>;
  /**
   * Issue 151: the product's subscriptions due the week, each with its member and which email it gets. "First week" is
   * the subscription's earliest `paid` ledger row, as `findMemberSubscription` reads it. Empty for a product id that
   * isn't a UUID. Issue 134: due as of `cutoff`, the week's cutoff instant, the one `enrolWeek` reads: a subscription
   * cancelled at or after it is due.
   */
  listWeekDue(productId: string, weekOf: string, cutoff: Date): Promise<WeekDue[]>;
  /**
   * Issue 134: inserts a `pending` row for `weekOf`, attempt 1, at the sum of the picks in effect for it, for each of the
   * product's subscriptions due it as of `cutoff`, with `on conflict (subscription_id, pickup_date) do nothing`; nothing
   * for a closed week. Returns the rows inserted; 0 for a product id that isn't a UUID.
   */
  enrolWeek(productId: string, weekOf: string, cutoff: Date): Promise<EnrolledWeek>;
  /**
   * Issue 134: the product's `pending` ledger rows whose subscription has a card or whose charge is out (its
   * `charge_sent_at` set), and, issue 254, `declined` rows whose charge is out (a card update's), oldest `pickup_date` first, then
   * subscription `created_at`; and an active subscription's `pending` row with neither, for the run to decline `NO_CARD`.
   */
  listPendingCharges(productId: string): Promise<PendingCharge[]>;
  /**
   * Issue 134: deletes the row only when it is `pending`, its subscription is not `pending` and its week is closed; true
   * when it deleted; false for an id that isn't a UUID. It checks no date.
   */
  dropClosedWeekRow(ledgerId: string): Promise<boolean>;
  /** Issue 145: the subscription's stored card brand and last four; null when they are not stored. */
  findSubscriptionCard(subscriptionId: string): Promise<{ brand: string; last4: string } | null>;
  /** Issue 145: the subscription's `declined` rows, closed weeks' included, oldest week first. */
  listDeclinedCharges(subscriptionId: string): Promise<DeclinedCharge[]>;
  /**
   * Issue 145, issue 254: under the member row's lock: `inactive` when the subscription is not `active`; `out` when any
   * row's charge is out, with that row, nothing written; `busy` when it holds a `pending` row and has a card on file; else,
   * when an open week's `declined` row exists (oldest week first), marks its charge sent at `now`, bumps its attempt,
   * leaves it `declined` and returns it as `claimed`; else `nothing_owed`. It writes no card and deletes no row.
   */
  claimCardUpdate(subscriptionId: string, now: Date): Promise<CardUpdateClaim>;
  /**
   * Issue 145: the subscription's oldest row `listPendingCharges` lists (a card, or a charge out on a `pending` or `declined`
   * row, and a Square customer), from its select; a row whose charge is out comes before a `pending` one.
   */
  findPendingCharge(subscriptionId: string): Promise<PendingCharge | null>;
  /** Issue 145: the row, when it is one of this subscription's `paid` rows; null otherwise. */
  findPaidCharge(subscriptionId: string, ledgerId: string): Promise<{ ledgerId: string; pickupDate: string; amountCents: number } | null>;
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
  /**
   * Issue 138: the subscription's picks from `fromWeek` on are `choices`, and its `weekly_cents` is `weeklyCents`, in
   * one transaction. "unchanged", writing nothing, when the stored sets would end as they were. It checks no cutoff.
   */
  switchPicks(subscriptionId: string, choices: Record<string, string>, fromWeek: string, weeklyCents: number): Promise<"switched" | "unchanged">;
  /**
   * Issue 219: the subscription's set of picks in effect for `weekOf` (DEC-033), in option-type position order; `[]` when
   * no set starts on or before the week.
   */
  findOptionsForWeek(subscriptionId: string, weekOf: string): Promise<{ typeName: string; optionName: string }[]>;
  findOptionsForWeeks(subscriptionId: string, weekOfs: string[]): Promise<Map<string, { typeName: string; optionName: string }[]>>;
  /** Issue 142: the week's meals and skips, as of `cutoff`, the week's cutoff instant. */
  listWeekBoxes(productId: string, weekOf: string, cutoff: Date): Promise<WeekBoxes>;
  /** A product's active and cancelled subscriptions (issue 139), unsorted by contract beyond being stable. */
  listSubscribers(productId: string): Promise<Subscriber[]>;
  /** Issue 140: every menu, newest `updatedAt` first. */
  listMenus(): Promise<Menu[]>;
  /** Issue 140: null for an unknown id and for a string that isn't a UUID. */
  findMenu(id: string): Promise<Menu | null>;
  createMenu(input: MenuInput): Promise<Menu>;
  /** Issue 140: replaces the menu's texts whole; null, writing nothing, for an unknown id. */
  saveMenu(id: string, input: MenuInput): Promise<Menu | null>;
  /** Issue 140: week key → menu id, for the product's weeks from `from` on. */
  listWeekMenus(productId: string, from: string): Promise<Map<string, string>>;
  /** Issue 140: null deletes the week's row; false, writing nothing, for an unknown menu. */
  assignWeekMenu(productId: string, weekOf: string, menuId: string | null): Promise<boolean>;
  // Issue 141: a week's menu and the stamp that sends its email once, the boxes a week makes, the admins, the event dated, the preference.
  findWeekMenu(productId: string, weekOf: string): Promise<{ menu: Menu; sentAt: Date | null } | null>;
  findWeekMenus(productId: string, weekOfs: string[]): Promise<Map<string, { menu: Menu; sentAt: Date | null }>>;
  markWeekMenuSent(productId: string, weekOf: string, now: Date): Promise<boolean>;
  listWeekMade(productId: string, weekOf: string): Promise<WeekMade[]>;
  listAdmins(): Promise<Member[]>;
  hasEventOn(kind: AuditEventKind, clevelandDate: string): Promise<boolean>;
  /** Issue 231: the `settings` row's value for `key`; null when it has none. */
  readSetting(key: string): Promise<string | null>;
  setMenuEmails(memberId: string, on: boolean): Promise<Member | null>;
  /**
   * Issue 174: a token when this call took the run's lease (none held, or the held one expired at or before `at`), held
   * until `until`; null otherwise.
   */
  claimRunLease(name: string, at: Date, until: Date): Promise<string | null>;
  /** Issue 174: deletes the run's lease only when `token` is the one it holds. */
  releaseRunLease(name: string, token: string): Promise<void>;
  recordEvent(event: AuditEvent): Promise<void>;
  /**
   * Runs `fn` on a repository scoped to `actor`: one transaction, committed when `fn` resolves and
   * rolled back when it throws. It does not nest.
   */
  withActor<T>(actor: Actor, fn: (repo: Repository) => Promise<T>): Promise<T>;
}
