import { DEFAULT_LANGUAGE, type Language } from "../i18n.js";
import { DuplicateEmailError, normalizeEmail, type Member } from "../members.js";
import type { Repository } from "../ports/repository.js";
import type { SignInCode } from "../sign-in/store.js";
import { createPool, type Pool } from "./pg-connect.js";

type MemberRow = { id: string; email: string; language: Language; created_at: Date };

const toMember = (row: MemberRow): Member => ({
  id: row.id,
  email: row.email,
  language: row.language,
  createdAt: row.created_at,
});

type SignInCodeRow = {
  member_id: string;
  code_hash: string;
  created_at: Date;
  expires_at: Date;
  attempts: number;
  consumed_at: Date | null;
  failed_since: Date | null;
  failed_in_window: number;
};

const toSignInCode = (row: SignInCodeRow): SignInCode => ({
  subjectId: row.member_id,
  codeHash: row.code_hash,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  attempts: row.attempts,
  consumedAt: row.consumed_at,
  failedSince: row.failed_since,
  failedInWindow: row.failed_in_window,
});

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

  async createMember(input: { email: string; language?: Language }): Promise<Member> {
    const email = normalizeEmail(input.email);
    try {
      const { rows } = await this.pool.query<MemberRow>(
        "insert into members (email, language) values ($1, $2) returning id, email, language, created_at",
        [email, input.language ?? DEFAULT_LANGUAGE],
      );
      return toMember(rows[0] as MemberRow);
    } catch (e) {
      if (sqlState(e) === UNIQUE_VIOLATION) throw new DuplicateEmailError(email);
      throw e;
    }
  }

  async findMemberByEmail(email: string): Promise<Member | null> {
    const { rows } = await this.pool.query<MemberRow>(
      "select id, email, language, created_at from members where email = $1",
      [normalizeEmail(email)],
    );
    return rows[0] ? toMember(rows[0]) : null;
  }

  async findMemberById(id: string): Promise<Member | null> {
    try {
      const { rows } = await this.pool.query<MemberRow>(
        "select id, email, language, created_at from members where id = $1",
        [id],
      );
      return rows[0] ? toMember(rows[0]) : null;
    } catch (e) {
      if (sqlState(e) === INVALID_UUID) return null;
      throw e;
    }
  }

  async getSignInCode(subjectId: string): Promise<SignInCode | null> {
    const { rows } = await this.pool.query<SignInCodeRow>(
      `select member_id, code_hash, created_at, expires_at, attempts, consumed_at, failed_since, failed_in_window
         from sign_in_codes where member_id = $1`,
      [subjectId],
    );
    return rows[0] ? toSignInCode(rows[0]) : null;
  }

  async saveSignInCode(code: { subjectId: string; codeHash: string; createdAt: Date; expiresAt: Date }): Promise<void> {
    // The failure window (failed_since, failed_in_window) is left alone: a new code does not reset it.
    await this.pool.query(
      `insert into sign_in_codes (member_id, code_hash, created_at, expires_at)
       values ($1, $2, $3, $4)
       on conflict (member_id) do update
         set code_hash = excluded.code_hash,
             created_at = excluded.created_at,
             expires_at = excluded.expires_at,
             attempts = 0,
             consumed_at = null`,
      [code.subjectId, code.codeHash, code.createdAt, code.expiresAt],
    );
  }

  /**
   * One row-locked `update … returning`, so concurrent claims cannot pass a cap together: a waiting
   * update re-reads the row and re-checks its `where` once the lock frees. With a null subject id the
   * same statement runs and matches no row.
   */
  async claimSignInAttempt(
    subjectId: string | null,
    claim: { presentedHash: string; maxAttempts: number; now: Date; windowMs: number; maxFailures: number },
  ): Promise<{ codeHash: string; expiresAt: Date } | null> {
    // "Live": failed_since is set and now < failed_since + windowMs.
    const live = "(failed_since is not null and $3::timestamptz < failed_since + $4::double precision * interval '1 millisecond')";
    const { rows } = await this.pool.query<{ code_hash: string; expires_at: Date }>(
      `update sign_in_codes
          set attempts = attempts + 1,
              failed_since = case when code_hash = $2 or ${live} then failed_since else $3::timestamptz end,
              failed_in_window = case when code_hash = $2 then failed_in_window
                                      when ${live} then failed_in_window + 1
                                      else 1 end
        where member_id = $1
          and consumed_at is null
          and attempts < $5
          and (code_hash = $2 or not (${live} and failed_in_window >= $6))
        returning code_hash, expires_at`,
      [subjectId, claim.presentedHash, claim.now, claim.windowMs, claim.maxAttempts, claim.maxFailures],
    );
    return rows[0] ? { codeHash: rows[0].code_hash, expiresAt: rows[0].expires_at } : null;
  }

  async consumeSignInCode(subjectId: string, now: Date): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "update sign_in_codes set consumed_at = $2 where member_id = $1 and consumed_at is null",
      [subjectId, now],
    );
    return rowCount === 1;
  }

  async incrementRateLimit(bucket: string, key: string, windowStart: Date, expiresAt: Date, now: Date): Promise<number> {
    // Two statements, not one CTE: within one statement the upsert would still see the expired row
    // the delete removes, and count on from it instead of starting at 1.
    await this.pool.query("delete from rate_limit_hits where expires_at <= $1", [now]);
    const { rows } = await this.pool.query<{ hits: number }>(
      `insert into rate_limit_hits (bucket, key, window_start, expires_at, hits)
       values ($1, $2, $3, $4, 1)
       on conflict (bucket, key, window_start) do update set hits = rate_limit_hits.hits + 1
       returning hits`,
      [bucket, key, windowStart, expiresAt],
    );
    return (rows[0] as { hits: number }).hits;
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
