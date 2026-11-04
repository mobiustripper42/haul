import { randomUUID } from "node:crypto";
import { DEFAULT_LANGUAGE, type Language } from "../i18n.js";
import { DEFAULT_ROLE, DuplicateEmailError, normalizeEmail, type Member, type Role } from "../members.js";
import type { Actor, AuditEvent, Repository } from "../ports/repository.js";
import { MemorySignInStore } from "../sign-in/memory-store.js";
import type { SignInCode } from "../sign-in/store.js";

/** The permanent fake (DEC-010): same behaviour as `PostgresRepository`, proved by one contract. */
export class InMemoryRepository implements Repository {
  private readonly members = new Map<string, Member>();
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
      this.signIn.restore(signIn);
      this.recorded.splice(0, this.recorded.length, ...recorded);
      throw error;
    }
  }

  /** The events recorded, in order, each with the actor it was recorded under; for tests. */
  events(): RecordedEvent[] {
    return this.recorded.map(copyEvent);
  }

  private find(match: (member: Member) => boolean): Member | null {
    for (const member of this.members.values()) if (match(member)) return copy(member);
    return null;
  }
}

// Callers get their own object, as they would from a database row, so mutating one can't edit the store.
const copy = (member: Member): Member => ({ ...member, createdAt: new Date(member.createdAt) });

/** An event as recorded: with who acted, null outside `withActor`. */
export type RecordedEvent = AuditEvent & { actor: Actor };

// The same for an event, its refusal's window start and its actor included.
const copyEvent = (event: RecordedEvent): RecordedEvent => {
  const actor = event.actor && { ...event.actor };
  return event.kind === "rate_limit_refusal"
    ? { ...event, windowStart: new Date(event.windowStart), actor }
    : { ...event, actor };
};
