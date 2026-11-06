import { randomUUID } from "node:crypto";
import type { AccountDetails } from "../create-account.js";
import { DEFAULT_LANGUAGE, type Language } from "../i18n.js";
import { DEFAULT_ROLE, DuplicateEmailError, normalizeEmail, type Member, type Role } from "../members.js";
import type { Actor, AuditEvent, PendingSignup, PendingSignupInput, Repository, SignupConfirmation } from "../ports/repository.js";
import type { ProductInput, ProductWithOptions } from "../products.js";
import { MemorySignInStore } from "../sign-in/memory-store.js";
import type { SignInCode } from "../sign-in/store.js";

type StoredSubscription = {
  id: string;
  memberId: string;
  productId: string;
  status: "pending" | "active";
  squareCardId: string | null;
  consentText: string;
  consentAt: Date;
  firstChargeCents: number;
  weeklyCents: number;
  createdAt: Date;
  /** Option type id → option id. */
  optionIds: Record<string, string>;
};

type StoredLedger = {
  id: string;
  subscriptionId: string;
  pickupDate: string;
  amountCents: number;
  status: "pending" | "paid" | "declined";
  attempt: number;
  squarePaymentId: string | null;
  paidAt: Date | null;
};

/** The permanent fake (DEC-010): same behaviour as `PostgresRepository`, proved by one contract. */
export class InMemoryRepository implements Repository {
  private readonly members = new Map<string, Member>();
  // Entries are replaced, never mutated: `withActor` restores the maps' entries on rollback.
  private readonly subscriptions = new Map<string, StoredSubscription>();
  private readonly ledger = new Map<string, StoredLedger>();
  private readonly products: ProductWithOptions[] = [];
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
      optionIds: Object.values(subscription.optionIds),
    };
  }

  async savePendingSignup(input: PendingSignupInput): Promise<PendingSignup> {
    const existing = this.subscriptionsOf(input.memberId, input.productId, "pending")[0];
    const subscription: StoredSubscription = {
      id: existing?.id ?? randomUUID(),
      memberId: input.memberId,
      productId: input.productId,
      status: "pending",
      squareCardId: existing?.squareCardId ?? null,
      consentText: input.consentText,
      consentAt: new Date(input.consentAt),
      firstChargeCents: input.firstChargeCents,
      weeklyCents: input.weeklyCents,
      createdAt: existing?.createdAt ?? new Date(),
      optionIds: { ...input.choices },
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
    if (declined) subscription.squareCardId = null;
    this.subscriptions.set(subscription.id, subscription);
    this.ledger.set(ledger.id, ledger);
    const saved = await this.findPendingSignup(input.memberId, input.productId);
    return saved as PendingSignup;
  }

  async saveSubscriptionCard(subscriptionId: string, cardId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) this.subscriptions.set(subscriptionId, { ...subscription, squareCardId: cardId });
  }

  async recordSignupDecline(ledgerId: string): Promise<void> {
    const row = this.ledger.get(ledgerId);
    if (row?.status === "pending") this.ledger.set(ledgerId, { ...row, status: "declined" });
  }

  async confirmSignupRows(ledgerId: string, paymentId: string, now: Date): Promise<"confirmed" | "already"> {
    const row = this.ledger.get(ledgerId);
    if (!row || row.status === "paid") return "already";
    this.ledger.set(ledgerId, { ...row, status: "paid", squarePaymentId: paymentId, paidAt: new Date(now) });
    const subscription = this.subscriptions.get(row.subscriptionId);
    if (subscription) this.subscriptions.set(subscription.id, { ...subscription, status: "active" });
    return "confirmed";
  }

  async findSignupConfirmation(memberId: string): Promise<SignupConfirmation | null> {
    const subscription = [...this.subscriptions.values()]
      .filter((s) => s.memberId === memberId && s.status === "active")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const ledger = subscription && this.ledgerOf(subscription.id);
    if (!subscription || !ledger) return null;
    const product = this.products.find((p) => p.id === subscription.productId);
    const options = (product?.optionTypes ?? []).flatMap((type) => {
      const picked = type.options.find((option) => option.id === subscription.optionIds[type.id]);
      return picked ? [{ typeName: type.name, optionName: picked.name }] : [];
    });
    return {
      pickupDate: ledger.pickupDate,
      firstChargeCents: subscription.firstChargeCents,
      weeklyCents: subscription.weeklyCents,
      options,
    };
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
      this.signIn.restore(signIn);
      this.recorded.splice(0, this.recorded.length, ...recorded);
      throw error;
    }
  }

  /** The events recorded, in order, each with the actor it was recorded under; for tests. */
  events(): RecordedEvent[] {
    return this.recorded.map(copyEvent);
  }

  /** The member's subscriptions to the product with `status`, oldest first. */
  private subscriptionsOf(memberId: string, productId: string, status: "pending" | "active"): StoredSubscription[] {
    return [...this.subscriptions.values()]
      .filter((s) => s.memberId === memberId && s.productId === productId && s.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /** A subscription's earliest ledger row. */
  private ledgerOf(subscriptionId: string): StoredLedger | undefined {
    return [...this.ledger.values()]
      .filter((row) => row.subscriptionId === subscriptionId)
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
