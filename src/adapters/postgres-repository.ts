import { DuplicateEmailError, normalizeEmail, type Member } from "../members.js";
import type { Repository } from "../ports/repository.js";
import { createPool, type Pool } from "./pg-connect.js";

type MemberRow = { id: string; email: string; created_at: Date };

const toMember = (row: MemberRow): Member => ({ id: row.id, email: row.email, createdAt: row.created_at });

// SQLSTATEs: a unique violation, and a value that isn't a valid uuid.
const UNIQUE_VIOLATION = "23505";
const INVALID_UUID = "22P02";

const sqlState = (e: unknown): string | undefined => (e as { code?: string }).code;

export class PostgresRepository implements Repository {
  private readonly pool: Pool;

  // TLS is applied inside the constructor, through `createPool`, per DEC-001.
  constructor(url: string) {
    this.pool = createPool(url);
  }

  async createMember(input: { email: string }): Promise<Member> {
    const email = normalizeEmail(input.email);
    try {
      const { rows } = await this.pool.query<MemberRow>(
        "insert into members (email) values ($1) returning id, email, created_at",
        [email],
      );
      return toMember(rows[0] as MemberRow);
    } catch (e) {
      if (sqlState(e) === UNIQUE_VIOLATION) throw new DuplicateEmailError(email);
      throw e;
    }
  }

  async findMemberByEmail(email: string): Promise<Member | null> {
    const { rows } = await this.pool.query<MemberRow>(
      "select id, email, created_at from members where email = $1",
      [normalizeEmail(email)],
    );
    return rows[0] ? toMember(rows[0]) : null;
  }

  async findMemberById(id: string): Promise<Member | null> {
    try {
      const { rows } = await this.pool.query<MemberRow>(
        "select id, email, created_at from members where id = $1",
        [id],
      );
      return rows[0] ? toMember(rows[0]) : null;
    } catch (e) {
      if (sqlState(e) === INVALID_UUID) return null;
      throw e;
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
