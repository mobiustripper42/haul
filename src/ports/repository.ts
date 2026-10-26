import type { Member } from "../members.js";

/**
 * The core's view of stored data (DEC-010). `InMemoryRepository` is the permanent fake and the
 * test substrate; `PostgresRepository` is the real one; one contract suite runs against both.
 */
export interface Repository {
  /** Throws `DuplicateEmailError` when the email, normalized, is already taken. */
  createMember(input: { email: string }): Promise<Member>;
  findMemberByEmail(email: string): Promise<Member | null>;
  /** Null for an unknown id and for a string that isn't a UUID. */
  findMemberById(id: string): Promise<Member | null>;
}
