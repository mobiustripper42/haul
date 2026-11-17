import { randomUUID } from "node:crypto";
import type { AccountDetails } from "../create-account.js";
import { DEFAULT_LANGUAGE, type Language } from "../i18n.js";
import { DEFAULT_ROLE, DuplicateEmailError, normalizeEmail, type Member, type Role } from "../members.js";
import type { Menu, MenuInput } from "../menus.js";
import type { Card } from "../ports/payments.js";
import {
  SignupRefusedError,
  type Actor,
  type AuditEvent,
  type AuditEventKind,
  type CardUpdateClaim,
  type DeclinedCharge,
  type EmailChange,
  type EnrolledWeek,
  type MemberSubscription,
  type MemberWeeks,
  type PendingCharge,
  type PendingSignup,
  type PendingSignupInput,
  type Repository,
  type SignupConfirmation,
  type Subscriber,
  type WeekBoxes,
  type WeekCredit,
  type WeekDue,
  type WeekMade,
} from "../ports/repository.js";
import { addDays, clevelandDate, pickupWeek, type ChangedWeek } from "../pickup-week.js";
import { sameChoices } from "../switch-meal.js";
import { isSoldOut, priceOfChoices, type ProductInput, type ProductWithOptions } from "../products.js";
import { CODE_TTL_MS } from "../sign-in/code.js";
import { MemorySignInStore } from "../sign-in/memory-store.js";
import type { SignInCode } from "../sign-in/store.js";

type StoredSubscription = {
  id: string;
  memberId: string;
  productId: string;
  status: "pending" | "active" | "cancelled";
  /** The time of the cancel; set exactly when `status` is `cancelled`. */
  cancelledAt: Date | null;
  squareCardId: string | null;
  /** The card's brand and last four, stored beside its id (issue 145); null with no card, or one bound before they were. */
  cardBrand: string | null;
  cardLast4: string | null;
  consentText: string;
  consentAt: Date;
  firstChargeCents: number;
  weeklyCents: number;
  createdAt: Date;
  /** The subscription's sets of picks, each option type id → option id from the week it starts at (`from_week`). */
  sets: StoredSet[];
};

type StoredSet = { fromWeek: string; optionIds: Record<string, string> };

type StoredLedger = {
  id: string;
  subscriptionId: string;
  pickupDate: string;
  amountCents: number;
  status: "pending" | "paid" | "declined" | "skipped" | "locked";
  attempt: number;
  squarePaymentId: string | null;
  paidAt: Date | null;
};

type StoredWeekCredit = {
  id: string;
  subscriptionId: string;
  /** The paid ledger row the week credit answers for; one week credit each. */
  grantedFor: string;
  spentOn: string | null;
  grantedAt: Date;
  /** The subscription's picks at the grant, option type id → option id. */
  optionIds: Record<string, string>;
};

/** The permanent fake (DEC-010): same behaviour as `PostgresRepository`, proved by one contract. */
export class InMemoryRepository implements Repository {
  private readonly members = new Map<string, Member>();
  // Entries are replaced, never mutated: `withActor` restores the maps' entries on rollback.
  private readonly subscriptions = new Map<string, StoredSubscription>();
  private readonly ledger = new Map<string, StoredLedger>();
  private readonly weekCredits = new Map<string, StoredWeekCredit>();
  /** Member id → their pending email change. Replaced, never mutated, like the maps above. */
  private readonly emailChanges = new Map<string, EmailChange>();
  /** Issue 174: run name → the lease on it. Set and deleted outside `withActor`, so never rolled back. */
  private readonly runLeases = new Map<string, { token: string; until: Date }>();
  private readonly products: ProductWithOptions[] = [];
  /** `<product id>|<week_of>` → the changed week. Replaced, never mutated, like the maps above. */
  private readonly pickupWeeks = new Map<string, ChangedWeek>();
  /** Issue 140: menu id → the menu. Replaced, never mutated, like the maps above. */
  private readonly menus = new Map<string, Menu>();
  /** Issue 140: `<product id>|<week_of>` → the menu on that week. */
  private readonly weekMenus = new Map<string, string>();
  /** Issue 141: `<product id>|<week_of>` → when the menu on that week was emailed; deleted with the row. */
  private readonly weekMenuSent = new Map<string, Date>();
  // The sign-in store's seven methods are the folder's own fake, which the sign-in contract proves.
  private readonly signIn = new MemorySignInStore();
  private readonly recorded: RecordedEvent[] = [];
  // Set on the view `withActor` hands its function, which shares this repository's state.
  private actor: Actor = null;
  private scoped = false;

  async createMember(input: { email: string; language?: Language; role?: Role }): Promise<Member> {
    const email = normalizeEmail(input.email);
    if (this.find((m) => m.email === email)) throw new DuplicateEmailError(email);
    const member: Member = {
      id: randomUUID(),
      email,
      language: input.language ?? DEFAULT_LANGUAGE,
      role: input.role ?? DEFAULT_ROLE,
      createdAt: new Date(),
      firstName: null,
      lastName: null,
      phone: null,
      emailConfirmedAt: null,
      squareCustomerId: null,
      menuEmails: true,
    };
    this.members.set(member.id, member);
    return copy(member);
  }

  async findMemberByEmail(email: string): Promise<Member | null> {
    const wanted = normalizeEmail(email);
    return this.find((m) => m.email === wanted);
  }

  async findMemberById(id: string): Promise<Member | null> {
    const member = this.members.get(id);
    return member ? copy(member) : null;
  }

  async saveAccount(input: AccountDetails): Promise<Member> {
    const email = normalizeEmail(input.email);
    const existing = this.find((m) => m.email === email) ?? (await this.createMember({ email }));
    if (existing.emailConfirmedAt !== null) return existing;
    // A new object, not a mutation: `withActor` restores the map's entries on rollback.
    const replaced: Member = {
      ...existing,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      language: input.language,
    };
    this.members.set(replaced.id, replaced);
    return copy(replaced);
  }

  async confirmMemberEmail(memberId: string, now: Date): Promise<void> {
    const member = this.members.get(memberId);
    if (member && member.emailConfirmedAt === null) this.members.set(memberId, { ...member, emailConfirmedAt: new Date(now) });
  }

  async saveMemberDetails(memberId: string, details: { firstName: string; lastName: string; phone: string; language: Language; menuEmails: boolean }): Promise<Member> {
    const member = this.members.get(memberId);
    if (!member) throw new Error(`saveMemberDetails: no member ${memberId}`);
    // A new object, not a mutation: `withActor` restores the map's entries on rollback.
    const replaced: Member = { ...member, ...details };
    this.members.set(memberId, replaced);
    return copy(replaced);
  }

  async startEmailChange(input: { memberId: string; newEmail: string; codeHash: string; now: Date }): Promise<void> {
    this.emailChanges.set(input.memberId, {
      memberId: input.memberId,
      newEmail: normalizeEmail(input.newEmail),
      codeHash: input.codeHash,
      expiresAt: new Date(input.now.getTime() + CODE_TTL_MS),
      attempts: 0,
    });
  }

  async findEmailChange(memberId: string): Promise<EmailChange | null> {
    const change = this.emailChanges.get(memberId);
    return change ? { ...change, expiresAt: new Date(change.expiresAt) } : null;
  }

  async countEmailChangeAttempt(memberId: string): Promise<number> {
    const change = this.emailChanges.get(memberId);
    if (!change) return 0;
    this.emailChanges.set(memberId, { ...change, attempts: change.attempts + 1 });
    return change.attempts + 1;
  }

  async applyEmailChange(memberId: string, now: Date): Promise<Member> {
    const member = this.members.get(memberId);
    const change = this.emailChanges.get(memberId);
    if (!member || !change) throw new Error(`applyEmailChange: no pending change for member ${memberId}`);
    if (this.find((m) => m.email === change.newEmail && m.id !== memberId)) throw new DuplicateEmailError(change.newEmail);
    const replaced: Member = { ...member, email: change.newEmail, emailConfirmedAt: new Date(now) };
    this.members.set(memberId, replaced);
    this.emailChanges.delete(memberId);
    return copy(replaced);
  }

  async dropEmailChange(memberId: string): Promise<void> {
    this.emailChanges.delete(memberId);
  }

  async findProductByName(name: string): Promise<ProductWithOptions | null> {
    const product = this.products.find((p) => p.name === name);
    return product ? structuredClone(product) : null;
  }

  /** A test seam on the fake only, not on `Repository`: assigns UUIDs and returns the product as `findProductByName` would. */
  addProduct(input: ProductInput): ProductWithOptions {
    const product: ProductWithOptions = {
      ...input,
      id: randomUUID(),
      optionTypes: input.optionTypes
        .map((type) => ({
          ...type,
          id: randomUUID(),
          menuTexts: type.menuTexts ?? false,
          options: type.options.map((option) => ({ ...option, id: randomUUID() })).sort(byPositionThenName),
        }))
        .sort(byPositionThenName),
    };
    this.products.push(product);
    return structuredClone(product);
  }

  async setMemberSquareCustomer(memberId: string, customerId: string): Promise<void> {
    const member = this.members.get(memberId);
    if (!member) return;
    // The database's unique index, as an error the same way.
    if (this.find((m) => m.id !== memberId && m.squareCustomerId === customerId)) {
      throw new Error(`Square customer ${customerId} already belongs to another member`);
    }
    this.members.set(memberId, { ...member, squareCustomerId: customerId });
  }

  async findActiveSubscription(memberId: string, productId: string): Promise<{ id: string } | null> {
    const found = this.subscriptionsOf(memberId, productId, "active")[0];
    return found ? { id: found.id } : null;
  }

  async findPendingSignup(memberId: string, productId: string): Promise<PendingSignup | null> {
    const subscription = this.subscriptionsOf(memberId, productId, "pending")[0];
    const ledger = subscription && this.ledgerOf(subscription.id);
    if (!subscription || !ledger) return null;
    return {
      subscriptionId: subscription.id,
      ledgerId: ledger.id,
      ledgerStatus: ledger.status,
      attempt: ledger.attempt,
      squareCardId: subscription.squareCardId,
      amountCents: ledger.amountCents,
      weeklyCents: subscription.weeklyCents,
      pickupDate: ledger.pickupDate,
      createdAt: new Date(subscription.createdAt),
      optionIds: Object.values(this.newestSet(subscription)?.optionIds ?? {}),
    };
  }

  async savePendingSignup(input: PendingSignupInput): Promise<PendingSignup> {
    if (this.subscriptionsOf(input.memberId, input.productId, "active").length > 0) throw new SignupRefusedError();
    const existing = this.subscriptionsOf(input.memberId, input.productId, "pending")[0];
    const earlier = existing && this.ledgerOf(existing.id);
    if (existing?.squareCardId && earlier?.status === "pending") throw new SignupRefusedError();
    const subscription: StoredSubscription = {
      id: existing?.id ?? randomUUID(),
      memberId: input.memberId,
      productId: input.productId,
      status: "pending",
      cancelledAt: null,
      squareCardId: existing?.squareCardId ?? null,
      cardBrand: existing?.cardBrand ?? null,
      cardLast4: existing?.cardLast4 ?? null,
      consentText: input.consentText,
      consentAt: new Date(input.consentAt),
      firstChargeCents: input.firstChargeCents,
      weeklyCents: input.weeklyCents,
      createdAt: existing?.createdAt ?? new Date(),
      // A retry replaces the pending subscription's set: it has no history.
      sets: [{ fromWeek: input.pickupDate, optionIds: { ...input.choices } }],
    };
    const before = existing && this.ledgerOf(existing.id);
    // A decline charged nothing, so the next try is a new attempt with no card; a pending row keeps both.
    const declined = before?.status === "declined";
    const ledger: StoredLedger = {
      id: before?.id ?? randomUUID(),
      subscriptionId: subscription.id,
      pickupDate: input.pickupDate,
      amountCents: input.firstChargeCents,
      status: declined ? "pending" : (before?.status ?? "pending"),
      attempt: before ? before.attempt + (declined ? 1 : 0) : 1,
      squarePaymentId: before?.squarePaymentId ?? null,
      paidAt: before?.paidAt ?? null,
    };
    if (declined) Object.assign(subscription, { squareCardId: null, cardBrand: null, cardLast4: null });
    this.subscriptions.set(subscription.id, subscription);
    this.ledger.set(ledger.id, ledger);
    const saved = await this.findPendingSignup(input.memberId, input.productId);
    return saved as PendingSignup;
  }

  async saveSubscriptionCard(
    subscriptionId: string,
    card: Card,
  ): Promise<{ amountCents: number; attempt: number } | "sold_out" | null> {
    const subscription = this.subscriptions.get(subscriptionId);
    const ledger = this.ledgerOf(subscriptionId);
    if (!subscription || !ledger || subscription.status !== "pending" || subscription.squareCardId !== null) return null;
    if (ledger.status !== "pending") return null;
    const product = this.products.find((p) => p.id === subscription.productId);
    if (product && isSoldOut(product, await this.countHeldSpots(product.id))) return "sold_out";
    this.subscriptions.set(subscriptionId, { ...subscription, squareCardId: card.id, cardBrand: card.brand, cardLast4: card.last4 });
    return { amountCents: ledger.amountCents, attempt: ledger.attempt };
  }

  async countHeldSpots(productId: string): Promise<number> {
    return [...this.subscriptions.values()].filter(
      (s) =>
        s.productId === productId &&
        (s.status === "active" || (s.squareCardId !== null && this.ledgerOf(s.id)?.status === "pending")),
    ).length;
  }

  async recordSignupDecline(ledgerId: string): Promise<boolean> {
    const row = this.ledger.get(ledgerId);
    if (row?.status !== "pending") return false;
    this.ledger.set(ledgerId, { ...row, status: "declined" });
    return true;
  }

  async confirmSignupRows(
    ledgerId: string,
    paymentId: string,
    amountCents: number,
    now: Date,
  ): Promise<"confirmed" | "already" | "mismatch"> {
    const row = this.ledger.get(ledgerId);
    if (!row || row.status === "paid") return "already";
    if (row.amountCents !== amountCents) return "mismatch";
    this.ledger.set(ledgerId, { ...row, status: "paid", squarePaymentId: paymentId, paidAt: new Date(now) });
    const subscription = this.subscriptions.get(row.subscriptionId);
    // Only a signup's subscription turns active: a charge run's row on an active or a cancelled one leaves its status.
    if (subscription?.status === "pending") this.subscriptions.set(subscription.id, { ...subscription, status: "active" });
    // A week that closed while the signup was paying: the week credit is granted here, as closing would have.
    if (subscription && this.pickupWeeks.get(weekKey(subscription.productId, row.pickupDate))?.closedAt != null) {
      this.grantWeekCredits(subscription.productId, row.pickupDate, now, ledgerId);
    }
    return "confirmed";
  }

  async findSignupConfirmation(memberId: string, productId: string): Promise<SignupConfirmation | null> {
    return this.findSubscriptionOf(memberId, productId, ["active"])?.confirmation ?? null;
  }

  async findMemberSubscription(memberId: string, productId: string): Promise<MemberSubscription | null> {
    const found = this.findSubscriptionOf(memberId, productId, ["active", "cancelled"]);
    return found && { ...found.confirmation, status: found.status, cancelledAt: found.cancelledAt, declinedWeek: found.declinedWeek };
  }

  /** The member's newest subscription to the product with one of `statuses` and a paid row: its signup details, status and cancel time. */
  private findSubscriptionOf(
    memberId: string,
    productId: string,
    statuses: ("active" | "cancelled")[],
  ): { confirmation: SignupConfirmation; status: "active" | "cancelled"; cancelledAt: Date | null; declinedWeek: string | null } | null {
    const subscription = [...this.subscriptions.values()]
      .filter((s) => s.memberId === memberId && s.productId === productId && (statuses as string[]).includes(s.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const ledger = subscription && this.ledgerOf(subscription.id);
    if (!subscription || !ledger?.paidAt) return null;
    const week = pickupWeek(ledger.pickupDate, this.pickupWeeks.get(weekKey(subscription.productId, ledger.pickupDate)) ?? null);
    const newest = this.newestSet(subscription);
    return {
      confirmation: {
        subscriptionId: subscription.id,
        pickupDate: ledger.pickupDate,
        firstDay: week.firstDay,
        lastDay: week.lastDay,
        chargedDate: clevelandDate(ledger.paidAt),
        firstChargeCents: subscription.firstChargeCents,
        weeklyCents: subscription.weeklyCents,
        options: this.optionsNamed(subscription, newest?.optionIds ?? {}),
        optionsFromWeek: newest?.fromWeek ?? "",
        choices: { ...newest?.optionIds },
      },
      status: subscription.status as "active" | "cancelled",
      cancelledAt: subscription.cancelledAt && new Date(subscription.cancelledAt),
      declinedWeek: this.declinedRows(subscription.id).map((row) => row.pickupDate).sort()[0] ?? null,
    };
  }

  async cancelSubscription(subscriptionId: string, now: Date): Promise<boolean> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription?.status !== "active") return false;
    this.subscriptions.set(subscriptionId, { ...subscription, status: "cancelled", cancelledAt: new Date(now) });
    return true;
  }

  async listChangedWeeks(productId: string, from: string): Promise<ChangedWeek[]> {
    return [...this.pickupWeeks.entries()]
      .filter(([key, week]) => key === weekKey(productId, week.weekOf) && week.weekOf >= from)
      .map(([, week]) => copyWeek(week))
      .sort((a, b) => a.weekOf.localeCompare(b.weekOf));
  }

  /**
   * Replaces every column; a week left with nothing on it (not closed, not moved, no note) has no row: no row is an
   * ordinary week (DEC-030). It does not copy the table's refusals: 2.1b's calendar validates before it writes.
   */
  async savePickupWeek(productId: string, week: ChangedWeek): Promise<void> {
    const key = weekKey(productId, week.weekOf);
    if (week.closedAt === null && week.note === null && week.firstDay === null && week.lastDay === null) this.pickupWeeks.delete(key);
    else this.pickupWeeks.set(key, copyWeek(week));
  }

  /**
   * Closes the week, keeping an existing closing time and the days, and grants its week credits. True when this call
   * closed the week, false when it was already closed.
   */
  async closePickupWeek(productId: string, weekOf: string, note: string | null, now: Date): Promise<boolean> {
    const existing = this.pickupWeeks.get(weekKey(productId, weekOf));
    await this.savePickupWeek(productId, {
      weekOf,
      closedAt: existing?.closedAt ?? now,
      note,
      firstDay: existing?.firstDay ?? null,
      lastDay: existing?.lastDay ?? null,
    });
    this.grantWeekCredits(productId, weekOf, now);
    return !existing?.closedAt;
  }

  /** Withdraws the week's week credits, clears the closing and the note, and drops the row if nothing is left. */
  async reopenPickupWeek(productId: string, weekOf: string): Promise<void> {
    for (const credit of this.creditsOfWeek(productId, weekOf)) this.weekCredits.delete(credit.id);
    const existing = this.pickupWeeks.get(weekKey(productId, weekOf));
    if (existing) await this.savePickupWeek(productId, { ...existing, closedAt: null, note: null });
  }

  /** Every menu, newest `updatedAt` first. */
  async listMenus(): Promise<Menu[]> {
    return [...this.menus.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(copyMenu);
  }

  async findMenu(id: string): Promise<Menu | null> {
    const menu = this.menus.get(id);
    return menu ? copyMenu(menu) : null;
  }

  async createMenu(input: MenuInput): Promise<Menu> {
    const menu: Menu = { id: randomUUID(), name: input.name, texts: { ...input.texts }, updatedAt: new Date() };
    this.menus.set(menu.id, menu);
    return copyMenu(menu);
  }

  /** Replaces the name and the texts whole; null, writing nothing, for an unknown id. */
  async saveMenu(id: string, input: MenuInput): Promise<Menu | null> {
    if (!this.menus.has(id)) return null;
    const menu: Menu = { id, name: input.name, texts: { ...input.texts }, updatedAt: new Date() };
    this.menus.set(id, menu);
    return copyMenu(menu);
  }

  async listWeekMenus(productId: string, from: string): Promise<Map<string, string>> {
    const prefix = `${productId}|`;
    const found = new Map<string, string>();
    for (const [key, menuId] of this.weekMenus) {
      const weekOf = key.slice(prefix.length);
      if (key.startsWith(prefix) && weekOf >= from) found.set(weekOf, menuId);
    }
    return found;
  }

  async assignWeekMenu(productId: string, weekOf: string, menuId: string | null): Promise<boolean> {
    if (menuId === null) {
      this.weekMenus.delete(weekKey(productId, weekOf));
      this.weekMenuSent.delete(weekKey(productId, weekOf));
      return true;
    }
    if (!this.menus.has(menuId)) return false;
    this.weekMenus.set(weekKey(productId, weekOf), menuId);
    return true;
  }

  /** Issue 141: the week's menu as it is now, and when its email went out; null for a week with none. */
  async findWeekMenu(productId: string, weekOf: string): Promise<{ menu: Menu; sentAt: Date | null } | null> {
    const key = weekKey(productId, weekOf);
    const menu = this.menus.get(this.weekMenus.get(key) ?? "");
    const sentAt = this.weekMenuSent.get(key);
    return menu ? { menu: copyMenu(menu), sentAt: sentAt ? new Date(sentAt) : null } : null;
  }

  /** Issue 141: stamps the week's menu sent at `now`; true only when it held a menu not yet stamped. */
  async markWeekMenuSent(productId: string, weekOf: string, now: Date): Promise<boolean> {
    const key = weekKey(productId, weekOf);
    if (!this.weekMenus.has(key) || this.weekMenuSent.has(key)) return false;
    this.weekMenuSent.set(key, new Date(now));
    return true;
  }

  /** Issue 141: a `paid` or `declined` row of the week for each subscription of the product, oldest subscription first, with the picks `rowPicks` holds. */
  async listWeekMade(productId: string, weekOf: string): Promise<WeekMade[]> {
    return [...this.subscriptions.values()]
      .filter((subscription) => subscription.productId === productId)
      // Two subscriptions made in one millisecond keep the order they were made in: the map's, and the sort is stable.
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .flatMap((subscription): WeekMade[] => {
        const member = this.members.get(subscription.memberId);
        const row =[...this.ledger.values()].find(
          (found) => found.subscriptionId === subscription.id && found.pickupDate === weekOf && (found.status === "paid" || found.status === "declined"),
        );
        if (!member || !row) return [];
        return [{ subscriptionId: subscription.id, member: copy(member), options: this.optionsNamed(subscription, this.rowPicks(row)) }];
      });
  }

  async listAdmins(): Promise<Member[]> {
    return [...this.members.values()].filter((member) => member.role === "admin").map(copy);
  }

  /** Issue 141: whether an event of the kind carries `detail.date` equal to the date. */
  async hasEventOn(kind: AuditEventKind, clevelandDate: string): Promise<boolean> {
    return this.recorded.some((event) => event.kind !== "rate_limit_refusal" && event.kind === kind && event.detail?.date === clevelandDate);
  }

  async setMenuEmails(memberId: string, on: boolean): Promise<Member | null> {
    const member = this.members.get(memberId);
    if (!member) return null;
    // A new object, not a mutation: `withActor` restores the map's entries on rollback.
    const replaced: Member = { ...member, menuEmails: on };
    this.members.set(memberId, replaced);
    return copy(replaced);
  }

  async listWeekCredits(productId: string, weekOf: string): Promise<WeekCredit[]> {
    return this.creditsOfWeek(productId, weekOf).map((credit) => ({
      id: credit.id,
      subscriptionId: credit.subscriptionId,
      grantedFor: credit.grantedFor,
      spentOn: credit.spentOn,
      grantedAt: new Date(credit.grantedAt),
      optionIds: Object.values(credit.optionIds),
    }));
  }

  async listWeekDue(productId: string, weekOf: string, cutoff: Date): Promise<WeekDue[]> {
    return [...this.subscriptions.values()]
      .filter((subscription) => subscription.productId === productId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .flatMap((subscription): WeekDue[] => {
        const member = this.members.get(subscription.memberId);
        if (!member) return [];
        const due = (notice: WeekDue["notice"]): WeekDue[] => [{ subscriptionId: subscription.id, member: copy(member), notice }];
        const rows = [...this.ledger.values()].filter((row) => row.subscriptionId === subscription.id);
        if (rows.some((row) => row.status === "paid" && row.pickupDate === weekOf)) return due("weekCredit");
        return this.isDueAsOf(subscription, weekOf, cutoff) ? due("noCharge") : [];
      });
  }

  /**
   * A row, attempt 1, for each of the product's subscriptions due `weekOf` as of `cutoff` and holding no row for it; none for
   * a closed week (issue 150). A subscription holding an unspent week credit granted for an earlier week gets its row
   * `paid` at 0 cents, paid at the cutoff, with its oldest such week credit (by the granted-for week, then the credit's id)
   * spent on it, whatever its picks sum to; else one whose picks in effect for the week (DEC-033) sum to 0 cents gets the
   * same row, spending nothing; any other gets a `pending` row at the sum. Issue 196: an `active` subscription holding a
   * `declined` row for an earlier week is locked, and gets a `locked` row at 0 cents first of all: before a week credit,
   * which stays unspent, and before the 0-cent rule. A cancelled one holding such a row gets no row. Returns what it wrote, by kind.
   */
  async enrolWeek(productId: string, weekOf: string, cutoff: Date): Promise<EnrolledWeek> {
    const written: EnrolledWeek = { pending: 0, zeroCents: 0, byWeekCredit: [], locked: [] };
    const product = this.products.find((p) => p.id === productId);
    if (!product || this.pickupWeeks.get(weekKey(productId, weekOf))?.closedAt != null) return written;
    const due = [...this.subscriptions.values()]
      .filter((subscription) => subscription.productId === productId && this.isDueIgnoringDecline(subscription, weekOf, cutoff))
      .filter((subscription) => subscription.status === "active" || !this.holdsDeclinedRowBefore(subscription.id, weekOf))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    for (const subscription of due) {
      const picks = this.setInEffect(subscription.id, weekOf);
      const holds = [...this.ledger.values()].some((row) => row.subscriptionId === subscription.id && row.pickupDate === weekOf);
      if (holds) continue;
      if (this.holdsDeclinedRowBefore(subscription.id, weekOf)) {
        const ledgerId = await this.addLedgerRow(subscription.id, weekOf, "locked", 0);
        written.locked.push({ ledgerId, memberId: subscription.memberId });
        continue;
      }
      const credit = this.unspentCreditsBefore(subscription.id, weekOf)[0];
      if (!picks && !credit) continue;
      const cents = picks ? priceOfChoices(product, picks.optionIds) : 0;
      const paid = credit !== undefined || cents === 0;
      const ledgerId = await this.addLedgerRow(subscription.id, weekOf, paid ? "paid" : "pending", credit ? 0 : cents, paid ? cutoff : undefined);
      if (credit) {
        this.weekCredits.set(credit.id, { ...credit, spentOn: ledgerId });
        written.byWeekCredit.push({ ledgerId, memberId: subscription.memberId });
      } else if (paid) written.zeroCents++;
      else written.pending++;
    }
    return written;
  }

  /** The product's `pending` rows whose subscription has a card and whose member has a Square customer, oldest week first, then the subscription's `created_at`. */
  async listPendingCharges(productId: string): Promise<PendingCharge[]> {
    return [...this.ledger.values()]
      .flatMap((row): { row: StoredLedger; subscription: StoredSubscription; customerId: string; cardId: string }[] => {
        const subscription = this.subscriptions.get(row.subscriptionId);
        const customerId = subscription && this.members.get(subscription.memberId)?.squareCustomerId;
        if (row.status !== "pending" || subscription?.productId !== productId || !subscription.squareCardId || !customerId) return [];
        return [{ row, subscription, customerId, cardId: subscription.squareCardId }];
      })
      .sort(
        (a, b) =>
          a.row.pickupDate.localeCompare(b.row.pickupDate) ||
          a.subscription.createdAt.getTime() - b.subscription.createdAt.getTime() ||
          a.row.id.localeCompare(b.row.id),
      )
      .map(({ row, subscription, customerId, cardId }) => {
        const changed = this.pickupWeeks.get(weekKey(productId, row.pickupDate)) ?? null;
        return {
          ledgerId: row.id,
          subscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          memberId: subscription.memberId,
          customerId,
          cardId,
          amountCents: row.amountCents,
          attempt: row.attempt,
          pickupDate: row.pickupDate,
          createdAt: new Date(subscription.createdAt),
          closed: changed?.closedAt != null,
          lastPickupDay: pickupWeek(row.pickupDate, changed).lastDay,
        };
      });
  }

  /** Deletes the row when it is `pending`, its subscription is not `pending` and its week is closed. The date condition is the run's. */
  async dropClosedWeekRow(ledgerId: string): Promise<boolean> {
    const row = this.ledger.get(ledgerId);
    const subscription = row && this.subscriptions.get(row.subscriptionId);
    if (!row || !subscription || row.status !== "pending" || subscription.status === "pending") return false;
    if (this.pickupWeeks.get(weekKey(subscription.productId, row.pickupDate))?.closedAt == null) return false;
    return this.ledger.delete(ledgerId);
  }

  /**
   * Issue 145: a card update's one decision: `inactive` when the subscription is not `active`; `busy` when it holds a
   * `pending` row, whatever its week; else the closed weeks' `declined` rows are deleted, the card's id, brand and last four
   * are set, and the oldest open week's `declined` row, when one is left, turns `pending` with its attempt bumped, as
   * `claimed`; else `replaced`.
   */
  async claimCardUpdate(subscriptionId: string, card: Card): Promise<CardUpdateClaim> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription?.status !== "active") return { kind: "inactive" };
    const rows = [...this.ledger.values()].filter((row) => row.subscriptionId === subscriptionId);
    if (rows.some((row) => row.status === "pending")) return { kind: "busy" };
    const declined = rows.filter((row) => row.status === "declined");
    for (const row of declined) if (this.weekClosed(subscription.productId, row.pickupDate)) this.ledger.delete(row.id);
    this.subscriptions.set(subscriptionId, { ...subscription, squareCardId: card.id, cardBrand: card.brand, cardLast4: card.last4 });
    const open = declined.filter((row) => !this.weekClosed(subscription.productId, row.pickupDate)).sort((a, b) => a.pickupDate.localeCompare(b.pickupDate) || a.id.localeCompare(b.id))[0];
    if (!open) return { kind: "replaced" };
    this.ledger.set(open.id, { ...open, status: "pending", attempt: open.attempt + 1 });
    // The only pending row, since none was held above: the claimed one, as the run lists it.
    const charge = await this.findPendingCharge(subscriptionId);
    if (!charge) throw new Error("The claimed row has no card or Square customer");
    return { kind: "claimed", charge };
  }

  /** Issue 145: the subscription's oldest `pending` row with a card and a Square customer, as `listPendingCharges` lists it. */
  async findPendingCharge(subscriptionId: string): Promise<PendingCharge | null> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return null;
    return (await this.listPendingCharges(subscription.productId)).find((charge) => charge.subscriptionId === subscriptionId) ?? null;
  }

  async findSubscriptionCard(subscriptionId: string): Promise<{ brand: string; last4: string } | null> {
    const subscription = this.subscriptions.get(subscriptionId);
    return subscription?.cardBrand && subscription.cardLast4 ? { brand: subscription.cardBrand, last4: subscription.cardLast4 } : null;
  }

  /** The subscription's `declined` rows, closed weeks' included, oldest week first. */
  async listDeclinedCharges(subscriptionId: string): Promise<DeclinedCharge[]> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return [];
    return [...this.ledger.values()]
      .filter((row) => row.subscriptionId === subscriptionId && row.status === "declined")
      .sort((a, b) => a.pickupDate.localeCompare(b.pickupDate))
      .map((row) => ({
        ledgerId: row.id,
        pickupDate: row.pickupDate,
        amountCents: row.amountCents,
        attempt: row.attempt,
        closed: this.weekClosed(subscription.productId, row.pickupDate),
      }));
  }

  /** Issue 145: the row, when it is one of the subscription's `paid` rows; null otherwise. */
  async findPaidCharge(subscriptionId: string, ledgerId: string): Promise<{ ledgerId: string; pickupDate: string; amountCents: number } | null> {
    const row = this.ledger.get(ledgerId);
    return row?.subscriptionId === subscriptionId && row.status === "paid" ? { ledgerId: row.id, pickupDate: row.pickupDate, amountCents: row.amountCents } : null;
  }

  /** Whether an admin has closed the product's week. */
  private weekClosed(productId: string, weekOf: string): boolean {
    return this.pickupWeeks.get(weekKey(productId, weekOf))?.closedAt != null;
  }

  /**
   * Issue 196: whether the subscription is due `weekOf` as of `cutoff` and not locked: `isDueIgnoringDecline`, and it holds
   * no `declined` row for an earlier week. The one home of "due", shared by `listWeekDue`, `listWeekBoxes` and `enrolWeek`.
   */
  private isDueAsOf(subscription: StoredSubscription, weekOf: string, cutoff: Date): boolean {
    return this.isDueIgnoringDecline(subscription, weekOf, cutoff) && !this.holdsDeclinedRowBefore(subscription.id, weekOf);
  }

  /**
   * Issue 134: whether the subscription is due `weekOf` as of `cutoff`, locked or not: `active`, or `cancelled` at or after
   * the cutoff; the week on or after the first it paid for; no `skipped` row for it. Whether it already holds a row for the
   * week is `enrolWeek`'s alone. `enrolWeek` selects by it, to write a locked week's row.
   */
  private isDueIgnoringDecline(subscription: StoredSubscription, weekOf: string, cutoff: Date): boolean {
    const rows = [...this.ledger.values()].filter((row) => row.subscriptionId === subscription.id);
    const firstPaid = rows.filter((row) => row.status === "paid").map((row) => row.pickupDate).sort()[0];
    const skipped = rows.some((row) => row.status === "skipped" && row.pickupDate === weekOf);
    const live =
      subscription.status === "active" || (subscription.status === "cancelled" && subscription.cancelledAt !== null && subscription.cancelledAt.getTime() >= cutoff.getTime());
    return live && firstPaid !== undefined && firstPaid <= weekOf && !skipped;
  }

  /** Issue 196: the subscription's `declined` ledger rows: the one home of "this subscription's declined rows". */
  private declinedRows(subscriptionId: string): StoredLedger[] {
    return [...this.ledger.values()].filter((row) => row.subscriptionId === subscriptionId && row.status === "declined");
  }

  /** Whether the subscription holds a `declined` ledger row, in any week: the one home of the test, shared by `listSubscribers` and `listWeekBoxes`. */
  private holdsDeclinedRow(subscriptionId: string): boolean {
    return this.declinedRows(subscriptionId).length > 0;
  }

  /** Issue 196: whether the subscription holds a `declined` row for a week before `weekOf`, so it is locked for that week. */
  private holdsDeclinedRowBefore(subscriptionId: string, weekOf: string): boolean {
    return this.declinedRows(subscriptionId).some((row) => row.pickupDate < weekOf);
  }

  async listWeekCounts(productId: string, from: string): Promise<Map<string, { paid: number; weekCredits: number }>> {
    const counts = new Map<string, { paid: number; weekCredits: number }>();
    const countsOf = (week: string) => {
      const found = counts.get(week) ?? { paid: 0, weekCredits: 0 };
      counts.set(week, found);
      return found;
    };
    for (const row of this.ledger.values()) {
      if (row.status === "paid" && row.pickupDate >= from && this.subscriptions.get(row.subscriptionId)?.productId === productId) countsOf(row.pickupDate).paid++;
    }
    for (const credit of this.weekCredits.values()) {
      const row = this.ledger.get(credit.grantedFor);
      if (row && row.pickupDate >= from && this.subscriptions.get(credit.subscriptionId)?.productId === productId) countsOf(row.pickupDate).weekCredits++;
    }
    return counts;
  }

  async listMemberWeeks(subscriptionId: string): Promise<MemberWeeks> {
    const paid = [...this.ledger.values()]
      .filter((row) => row.subscriptionId === subscriptionId && row.status === "paid")
      .map((row) => ({
        weekOf: row.pickupDate,
        amountCents: row.amountCents,
        weekCredit: this.spentCreditOn(row.id) !== undefined,
        options: this.optionsNamed(this.subscriptions.get(subscriptionId), this.rowPicks(row)),
      }));
    const weekCredits = [...this.weekCredits.values()].flatMap((credit) => {
      const row = this.ledger.get(credit.grantedFor);
      return credit.subscriptionId === subscriptionId && credit.spentOn === null && row ? [{ grantedForWeek: row.pickupDate }] : [];
    });
    const skipped = [...this.ledger.values()]
      .filter((row) => row.subscriptionId === subscriptionId && row.status === "skipped")
      .map((row) => row.pickupDate);
    return { paid, weekCredits, skipped };
  }

  async skipWeek(subscriptionId: string, weekOf: string): Promise<boolean> {
    if (!this.subscriptions.has(subscriptionId)) return false;
    const taken = [...this.ledger.values()].some((row) => row.subscriptionId === subscriptionId && row.pickupDate === weekOf);
    if (taken) return false;
    await this.addLedgerRow(subscriptionId, weekOf, "skipped", 0);
    return true;
  }

  async unskipWeek(subscriptionId: string, weekOf: string): Promise<boolean> {
    const row = [...this.ledger.values()].find((found) => found.subscriptionId === subscriptionId && found.pickupDate === weekOf && found.status === "skipped");
    return row ? this.ledger.delete(row.id) : false;
  }

  /**
   * The picks from `fromWeek` on are `choices`: every set from that week on is deleted and the new one inserted at it,
   * unless it equals the set in effect for the week before (then it only deletes). The sets ending as they were is
   * "unchanged", and writes nothing, `weekly_cents` included.
   */
  async switchPicks(subscriptionId: string, choices: Record<string, string>, fromWeek: string, weeklyCents: number): Promise<"switched" | "unchanged"> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return "unchanged";
    const before = this.setInEffect(subscriptionId, addDays(fromWeek, -7));
    const kept = subscription.sets.filter((set) => set.fromWeek < fromWeek);
    const sets = before && sameChoices(before.optionIds, choices) ? kept : [...kept, { fromWeek, optionIds: { ...choices } }];
    if (JSON.stringify(sets.map(setKey)) === JSON.stringify(subscription.sets.map(setKey))) return "unchanged";
    this.subscriptions.set(subscriptionId, { ...subscription, sets, weeklyCents });
    return "switched";
  }

  /** A test seam on the fake only, not on `Repository`: a ledger row the charge run would write, and its id. */
  async addLedgerRow(subscriptionId: string, pickupDate: string, status: StoredLedger["status"], amountCents: number, paidAt?: Date): Promise<string> {
    const id = randomUUID();
    this.ledger.set(id, {
      id,
      subscriptionId,
      pickupDate,
      amountCents,
      status,
      attempt: 1,
      squarePaymentId: null,
      paidAt: status === "paid" ? new Date(paidAt ?? Date.now()) : null,
    });
    return id;
  }

  /**
   * Issue 142: the week's meals and skips of the product's `active` and `cancelled` subscriptions (a `pending` one's row
   * is a signup in progress). A subscription holding a `paid`, `pending` or `declined` row for the week is a meal, one
   * holding a `skipped` row a skip, one holding a `locked` row (issue 196) neither, and one with no row a meal when it is due
   * the week as of `cutoff` (`isDueAsOf`). Each
   * carries its member and its picks, named in option-type position order: the row's (`rowPicks`), else those in effect for the week.
   */
  async listWeekBoxes(productId: string, weekOf: string, cutoff: Date): Promise<WeekBoxes> {
    const lists: WeekBoxes = { boxes: [], skips: [] };
    for (const subscription of this.subscriptions.values()) {
      const member = this.members.get(subscription.memberId);
      if (subscription.productId !== productId || (subscription.status !== "active" && subscription.status !== "cancelled") || !member) continue;
      const row = [...this.ledger.values()].find((found) => found.subscriptionId === subscription.id && found.pickupDate === weekOf);
      const picks = row ? this.rowPicks(row) : (this.setInEffect(subscription.id, weekOf)?.optionIds ?? {});
      const who = {
        subscriptionId: subscription.id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        phone: member.phone,
        options: this.optionsNamed(subscription, picks),
      };
      if (row?.status === "locked") continue;
      if (row?.status === "skipped") lists.skips.push(who);
      else if (row !== undefined || this.isDueAsOf(subscription, weekOf, cutoff)) {
        lists.boxes.push({
          ...who,
          weekCredit: row !== undefined && this.spentCreditOn(row.id) !== undefined,
          cardDeclined: this.holdsDeclinedRow(subscription.id),
        });
      }
    }
    return lists;
  }

  async listSubscribers(productId: string): Promise<Subscriber[]> {
    return [...this.subscriptions.values()]
      .filter((s) => s.productId === productId && (s.status === "active" || s.status === "cancelled"))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .flatMap((subscription) => {
        const member = this.members.get(subscription.memberId);
        const paidAt = this.ledgerOf(subscription.id)?.paidAt;
        if (!member || !paidAt) return [];
        return [
          {
            subscriptionId: subscription.id,
            firstName: member.firstName,
            lastName: member.lastName,
            email: member.email,
            phone: member.phone,
            options: this.optionsNamed(subscription, this.newestSet(subscription)?.optionIds ?? {}),
            joinedDate: clevelandDate(paidAt),
            status: subscription.status as "active" | "cancelled",
            refundOwed: subscription.status === "cancelled" && this.unspentCreditsOf(subscription.id) > 0,
            cardDeclined: subscription.status === "active" && this.holdsDeclinedRow(subscription.id),
          },
        ];
      });
  }

  getSignInCode(subjectId: string): Promise<SignInCode | null> {
    return this.signIn.getSignInCode(subjectId);
  }

  saveSignInCode(
    code: Parameters<Repository["saveSignInCode"]>[0],
    hold?: Parameters<Repository["saveSignInCode"]>[1],
  ): Promise<boolean> {
    return this.signIn.saveSignInCode(code, hold);
  }

  claimSignInAttempt(
    subjectId: string | null,
    claim: Parameters<Repository["claimSignInAttempt"]>[1],
  ): ReturnType<Repository["claimSignInAttempt"]> {
    return this.signIn.claimSignInAttempt(subjectId, claim);
  }

  consumeSignInCode(subjectId: string, now: Date): Promise<boolean> {
    return this.signIn.consumeSignInCode(subjectId, now);
  }

  saveSignInLink(
    link: Parameters<Repository["saveSignInLink"]>[0],
    hold?: Parameters<Repository["saveSignInLink"]>[1],
  ): Promise<boolean> {
    return this.signIn.saveSignInLink(link, hold);
  }

  redeemSignInLink(linkHash: string, now: Date): Promise<string | null> {
    return this.signIn.redeemSignInLink(linkHash, now);
  }

  incrementRateLimit(bucket: string, key: string, windowStart: Date, expiresAt: Date, now: Date): Promise<number> {
    return this.signIn.incrementRateLimit(bucket, key, windowStart, expiresAt, now);
  }

  async claimRunLease(name: string, at: Date, until: Date): Promise<string | null> {
    const held = this.runLeases.get(name);
    if (held && held.until.getTime() > at.getTime()) return null;
    const token = randomUUID();
    this.runLeases.set(name, { token, until: new Date(until) });
    return token;
  }

  async releaseRunLease(name: string, token: string): Promise<void> {
    if (this.runLeases.get(name)?.token === token) this.runLeases.delete(name);
  }

  async recordEvent(event: AuditEvent): Promise<void> {
    this.recorded.push(copyEvent({ ...event, actor: this.actor }));
  }

  /**
   * Runs `fn` on a view of this repository that records `actor` on its events. What `fn` wrote is kept
   * when it resolves; when it throws, members, sign-in state and events go back to what they were
   * (DEC-010: the Postgres adapter rolls back). The view does not nest.
   */
  async withActor<T>(actor: Actor, fn: (repo: Repository) => Promise<T>): Promise<T> {
    if (this.scoped) throw new Error("withActor does not nest");
    const members = new Map(this.members);
    const subscriptions = new Map(this.subscriptions);
    const ledger = new Map(this.ledger);
    const weekCredits = new Map(this.weekCredits);
    const pickupWeeks = new Map(this.pickupWeeks);
    const emailChanges = new Map(this.emailChanges);
    const menus = new Map(this.menus);
    const weekMenus = new Map(this.weekMenus);
    const weekMenuSent = new Map(this.weekMenuSent);
    const signIn = this.signIn.snapshot();
    const recorded = this.recorded.map(copyEvent);

    const view: InMemoryRepository = Object.create(this);
    view.actor = actor;
    view.scoped = true;
    try {
      return await fn(view);
    } catch (error) {
      this.members.clear();
      for (const [id, member] of members) this.members.set(id, member);
      this.subscriptions.clear();
      for (const [id, subscription] of subscriptions) this.subscriptions.set(id, subscription);
      this.ledger.clear();
      for (const [id, row] of ledger) this.ledger.set(id, row);
      this.weekCredits.clear();
      for (const [id, credit] of weekCredits) this.weekCredits.set(id, credit);
      this.pickupWeeks.clear();
      for (const [key, week] of pickupWeeks) this.pickupWeeks.set(key, week);
      this.emailChanges.clear();
      for (const [id, change] of emailChanges) this.emailChanges.set(id, change);
      this.menus.clear();
      for (const [id, menu] of menus) this.menus.set(id, menu);
      this.weekMenus.clear();
      for (const [key, menuId] of weekMenus) this.weekMenus.set(key, menuId);
      this.weekMenuSent.clear();
      for (const [key, sentAt] of weekMenuSent) this.weekMenuSent.set(key, sentAt);
      this.signIn.restore(signIn);
      this.recorded.splice(0, this.recorded.length, ...recorded);
      throw error;
    }
  }

  /** The events recorded, in order, each with the actor it was recorded under; for tests. */
  events(): RecordedEvent[] {
    return this.recorded.map(copyEvent);
  }

  /** How many week credits the subscription holds that are not yet spent. */
  private unspentCreditsOf(subscriptionId: string): number {
    return [...this.weekCredits.values()].filter((credit) => credit.subscriptionId === subscriptionId && credit.spentOn === null).length;
  }

  /** The member's subscriptions to the product with `status`, oldest first. */
  private subscriptionsOf(memberId: string, productId: string, status: "pending" | "active"): StoredSubscription[] {
    return [...this.subscriptions.values()]
      .filter((s) => s.memberId === memberId && s.productId === productId && s.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * One week credit for each `paid` ledger row of the product's subscriptions for the week that has none, copying
   * the subscription's picks and granted at `now`; with `only`, for that ledger row alone. The one home for
   * granting, called by closing and by a confirmation that lands after the week closed.
   */
  private grantWeekCredits(productId: string, weekOf: string, now: Date, only?: string): void {
    const granted = new Set([...this.weekCredits.values()].map((credit) => credit.grantedFor));
    for (const row of this.ledger.values()) {
      if (row.status !== "paid" || row.pickupDate !== weekOf || granted.has(row.id) || (only !== undefined && row.id !== only)) continue;
      const subscription = this.subscriptions.get(row.subscriptionId);
      if (subscription?.productId !== productId) continue;
      const id = randomUUID();
      this.weekCredits.set(id, {
        id,
        subscriptionId: subscription.id,
        grantedFor: row.id,
        spentOn: null,
        grantedAt: new Date(now),
        // The row's picks (`rowPicks`): not the subscription's picks at the grant.
        optionIds: { ...this.rowPicks(row) },
      });
    }
  }

  /** The week credits granted for the product's ledger rows of the week. */
  private creditsOfWeek(productId: string, weekOf: string): StoredWeekCredit[] {
    return [...this.weekCredits.values()].filter(
      (credit) =>
        this.ledger.get(credit.grantedFor)?.pickupDate === weekOf && this.subscriptions.get(credit.subscriptionId)?.productId === productId,
    );
  }

  /** The set in effect for `weekOf`: the subscription's set with the latest `fromWeek` on or before it. The one home of the rule. */
  private setInEffect(subscriptionId: string, weekOf: string): StoredSet | undefined {
    return [...(this.subscriptions.get(subscriptionId)?.sets ?? [])]
      .filter((set) => set.fromWeek <= weekOf)
      .sort((a, b) => b.fromWeek.localeCompare(a.fromWeek))[0];
  }

  /**
   * Issue 150, AC6: the picks of a paid ledger row, option type id → option id: those of the week credit spent on it when
   * there is one, else the set in effect for the row's week (DEC-033). The one home of the rule, used by `listMemberWeeks`
   * and `grantWeekCredits`.
   */
  private rowPicks(row: StoredLedger): Record<string, string> {
    return this.spentCreditOn(row.id)?.optionIds ?? this.setInEffect(row.subscriptionId, row.pickupDate)?.optionIds ?? {};
  }

  /** The week credit spent on the ledger row, if one is. */
  private spentCreditOn(ledgerId: string): StoredWeekCredit | undefined {
    return [...this.weekCredits.values()].find((credit) => credit.spentOn === ledgerId);
  }

  /** The subscription's unspent week credits granted for a week before `weekOf`, oldest first by that week, then by id. */
  private unspentCreditsBefore(subscriptionId: string, weekOf: string): StoredWeekCredit[] {
    return [...this.weekCredits.values()]
      .flatMap((credit) => {
        const granted = this.ledger.get(credit.grantedFor);
        return credit.subscriptionId === subscriptionId && credit.spentOn === null && granted && granted.pickupDate < weekOf ? [{ credit, week: granted.pickupDate }] : [];
      })
      .sort((a, b) => a.week.localeCompare(b.week) || a.credit.id.localeCompare(b.credit.id))
      .map(({ credit }) => credit);
  }

  /** The newest set: the one with the latest `fromWeek`, whatever week it starts from. */
  private newestSet(subscription: StoredSubscription): StoredSet | undefined {
    return [...subscription.sets].sort((a, b) => b.fromWeek.localeCompare(a.fromWeek))[0];
  }

  /** The options of a set, named, in option-type position order. */
  private optionsNamed(subscription: StoredSubscription | undefined, optionIds: Record<string, string>): Subscriber["options"] {
    const product = this.products.find((p) => p.id === subscription?.productId);
    return (product?.optionTypes ?? []).flatMap((type) => {
      const picked = type.options.find((option) => option.id === optionIds[type.id]);
      return picked ? [{ typeName: type.name, optionName: picked.name }] : [];
    });
  }

  /** A subscription's earliest ledger row of the signup's kinds: a skipped or a locked row is never the signup's. */
  private ledgerOf(subscriptionId: string): (StoredLedger & { status: PendingSignup["ledgerStatus"] }) | undefined {
    return [...this.ledger.values()]
      .filter((row): row is StoredLedger & { status: PendingSignup["ledgerStatus"] } => row.subscriptionId === subscriptionId && row.status !== "skipped" && row.status !== "locked")
      .sort((a, b) => a.pickupDate.localeCompare(b.pickupDate))[0];
  }

  private find(match: (member: Member) => boolean): Member | null {
    for (const member of this.members.values()) if (match(member)) return copy(member);
    return null;
  }
}

// Callers get their own object, as they would from a database row, so mutating one can't edit the store.
const copy = (member: Member): Member => ({
  ...member,
  createdAt: new Date(member.createdAt),
  emailConfirmedAt: member.emailConfirmedAt && new Date(member.emailConfirmedAt),
});

/** A set as a comparable string: its week and its picks in type id order. */
const setKey = (set: StoredSet): [string, [string, string][]] => [set.fromWeek, Object.entries(set.optionIds).sort(([a], [b]) => a.localeCompare(b))];

const weekKey = (productId: string, weekOf: string): string => `${productId}|${weekOf}`;

const copyWeek = (week: ChangedWeek): ChangedWeek => ({ ...week, closedAt: week.closedAt && new Date(week.closedAt) });

const copyMenu = (menu: Menu): Menu => ({ ...menu, texts: { ...menu.texts }, updatedAt: new Date(menu.updatedAt) });

/** The order `findProductByName` promises for option types and options. */
const byPositionThenName = (a: { position: number; name: string }, b: { position: number; name: string }): number =>
  a.position - b.position || a.name.localeCompare(b.name);

/** An event as recorded: with who acted, null outside `withActor`. */
export type RecordedEvent = AuditEvent & { actor: Actor };

// The same for an event, its refusal's window start and its actor included.
const copyEvent = (event: RecordedEvent): RecordedEvent => {
  const actor = event.actor && { ...event.actor };
  if (event.kind === "rate_limit_refusal") return { ...event, windowStart: new Date(event.windowStart), actor };
  return { ...event, ...(event.detail !== undefined && { detail: structuredClone(event.detail) }), actor };
};
