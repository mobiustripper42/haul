import type { Language } from "../i18n.js";
import type { Member } from "../members.js";
import type { RateLimitStore, SignInStore } from "../sign-in/store.js";

/**
 * The core's view of stored data (DEC-010). `InMemoryRepository` is the permanent fake and the
 * test substrate; `PostgresRepository` is the real one; one contract suite runs against both.
 *
 * It is also the sign-in store: a sign-in subject is a member, and `member_id` is the subject id.
 */
export interface Repository extends SignInStore, RateLimitStore {
  /** Throws `DuplicateEmailError` when the email, normalized, is already taken. The language defaults to `DEFAULT_LANGUAGE`. */
  createMember(input: { email: string; language?: Language }): Promise<Member>;
  findMemberByEmail(email: string): Promise<Member | null>;
  /** Null for an unknown id and for a string that isn't a UUID. */
  findMemberById(id: string): Promise<Member | null>;
}
