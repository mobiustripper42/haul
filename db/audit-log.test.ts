// Issue 11 — the audit trigger. Every test runs against a database of this suite's own,
// `<test db>_audit`, created if absent and migrated once with every file in db/migrations/. Without
// a reachable Postgres they skip locally and fail in CI (DEC-014).
//
// Members are inserted with fresh emails and left in place; each test reads only the audit rows
// written after the highest id it saw before acting.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "../src/adapters/pg-connect.js";
import type { Client } from "../src/adapters/pg-connect.js";
import { ensureTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { migrate } from "./migrate.js";

type AuditRow = {
  id: string;
  occurred_at: string;
  xact_id: string;
  table_name: string;
  operation: string;
  row_key: unknown;
  before: unknown;
  after: unknown;
  actor: string | null;
  db_user: string;
};

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC1–AC8, AC16–AC18 — the audit trigger against <test db>_audit${skipped}`, () => {
  let url: string;
  let db: Client;

  beforeAll(async () => {
    url = await ensureTestDatabase(TEST_DATABASE_URL, "audit");
    await migrate(url);
    db = createClient(url);
    await db.connect();
  });

  afterAll(async () => {
    await db?.end();
  });

  /** A connection of the test's own, for tests that depend on what one session has done before. */
  const connection = async (): Promise<Client> => {
    const c = createClient(url);
    await c.connect();
    return c;
  };

  const freshEmail = () => `${randomUUID()}@example.com`;

  /** The highest audit_log id so far: the rows after it are the ones a test is about to write. */
  const mark = async (c: Client = db): Promise<string> =>
    (await c.query<{ n: string }>("select coalesce(max(id), 0)::text as n from audit_log")).rows[0]?.n ?? "0";

  const since = async (m: string, c: Client = db): Promise<AuditRow[]> =>
    (
      await c.query<AuditRow>(
        `select id::text, occurred_at::text, xact_id::text, table_name, operation, row_key, before, after, actor, db_user
           from audit_log where audit_log.id > $1::bigint order by audit_log.id`,
        [m],
      )
    ).rows;

  const insertMember = async (c: Client = db, email = freshEmail()): Promise<string> => {
    const { rows } = await c.query<{ id: string }>("insert into members (email) values ($1) returning id", [email]);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("insert returned no id");
    return id;
  };

  /** The member's row as `to_jsonb` gives it. */
  const rowOf = async (id: string): Promise<unknown> =>
    (await db.query<{ row: unknown }>("select to_jsonb(m) as row from members m where id = $1", [id])).rows[0]?.row;

  it("AC1: inserting a member writes one insert row with its key, no before, and the new row as after", async () => {
    const m = await mark();
    const id = await insertMember();
    const row = await rowOf(id);

    expect(await since(m)).toEqual([
      expect.objectContaining({ table_name: "members", operation: "insert", row_key: { id }, before: null, after: row }),
    ]);
  });

  it("AC2: an update that changes a value writes one update row with the old row as before and the new as after", async () => {
    const id = await insertMember();
    const old = await rowOf(id);
    const m = await mark();

    await db.query("update members set language = 'es' where id = $1", [id]);
    const row = await rowOf(id);

    expect(row).not.toEqual(old);
    expect(await since(m)).toEqual([
      expect.objectContaining({ table_name: "members", operation: "update", row_key: { id }, before: old, after: row }),
    ]);
  });

  describe("AC3 — an update that changes nothing", () => {
    it("AC3: setting every column of a member to the value it already had writes no audit row", async () => {
      const id = await insertMember();
      const m = await mark();

      const { rowCount } = await db.query(
        "update members m set email = m.email, created_at = m.created_at, language = m.language, role = m.role where id = $1",
        [id],
      );

      expect(rowCount).toBe(1);
      expect(await since(m)).toEqual([]);
    });

    it("AC3: the members seed's upsert, re-run with the values a member already has, writes no audit row", async () => {
      const email = freshEmail();
      await insertMember(db, email);
      const m = await mark();

      const { rowCount } = await db.query(
        `insert into members (email, language, role) values ($1, 'en', 'member')
         on conflict (email) do update set language = excluded.language, role = excluded.role`,
        [email],
      );

      expect(rowCount).toBe(1);
      expect(await since(m)).toEqual([]);
    });
  });

  it("AC4: deleting a member writes one delete row with its key, the old row as before, and no after", async () => {
    const id = await insertMember();
    const old = await rowOf(id);
    const m = await mark();

    await db.query("delete from members where id = $1", [id]);

    expect(await since(m)).toEqual([
      expect.objectContaining({ table_name: "members", operation: "delete", row_key: { id }, before: old, after: null }),
    ]);
  });

  it("AC5: every audit row a transaction writes after set_config('haul.actor', …, true) carries that actor", async () => {
    const actor = `admin:${randomUUID()}`;
    const c = await connection();
    try {
      const m = await mark(c);
      await c.query("begin");
      await c.query("select set_config('haul.actor', $1, true)", [actor]);
      const id = await insertMember(c);
      await c.query("update members set language = 'es' where id = $1", [id]);
      await c.query("delete from members where id = $1", [id]);
      await c.query("commit");

      const rows = await since(m, c);
      expect(rows.map((r) => r.operation)).toEqual(["insert", "update", "delete"]);
      expect(rows.map((r) => r.actor)).toEqual([actor, actor, actor]);
    } finally {
      await c.end();
    }
  });

  it("AC6: a later transaction on the same connection that sets no actor writes actor null, not '' and not the earlier one", async () => {
    const c = await connection();
    try {
      await c.query("begin");
      await c.query("select set_config('haul.actor', $1, true)", [`admin:${randomUUID()}`]);
      await insertMember(c);
      await c.query("commit");
      // The trap this guards: once set in a session, the setting reads back as '' rather than null.
      expect((await c.query<{ v: string | null }>("select current_setting('haul.actor', true) as v")).rows).toEqual([
        { v: "" },
      ]);

      const m = await mark(c);
      await c.query("begin");
      await insertMember(c);
      await c.query("commit");

      expect(await since(m, c)).toEqual([expect.objectContaining({ operation: "insert", actor: null })]);
    } finally {
      await c.end();
    }
  });

  it("AC7: db_user is session_user, not current_user — a role with no rights on audit_log is recorded as itself", async () => {
    const probe = `probe_${randomUUID().replace(/-/g, "")}`;
    const c = await connection();
    try {
      await c.query("begin");
      await c.query(`create role "${probe}"`);
      await c.query(`grant insert, select on members to "${probe}"`);
      const m = await mark(c);

      await c.query(`set local session authorization "${probe}"`);
      expect((await c.query<{ s: string }>("select session_user::text as s")).rows).toEqual([{ s: probe }]);
      await insertMember(c);
      await c.query("reset session authorization");

      expect(await since(m, c)).toEqual([expect.objectContaining({ operation: "insert", db_user: probe })]);
    } finally {
      await c.query("rollback").catch(() => undefined);
      await c.end();
    }
  });

  describe("AC8 — xact_id and occurred_at", () => {
    it("AC8: rows written in one transaction share one xact_id and one occurred_at", async () => {
      const c = await connection();
      try {
        const m = await mark(c);
        await c.query("begin");
        const a = await insertMember(c);
        await insertMember(c);
        await c.query("select pg_sleep(0.01)");
        await c.query("update members set language = 'es' where id = $1", [a]);
        await c.query("commit");

        const rows = await since(m, c);
        expect(rows).toHaveLength(3);
        expect(new Set(rows.map((r) => r.xact_id)).size).toBe(1);
        expect(new Set(rows.map((r) => r.occurred_at)).size).toBe(1);
      } finally {
        await c.end();
      }
    });

    it("AC8: rows written by two transactions have different xact_ids", async () => {
      const c = await connection();
      try {
        const m = await mark(c);
        await c.query("begin");
        await insertMember(c);
        await c.query("commit");
        await c.query("begin");
        await insertMember(c);
        await c.query("commit");

        const rows = await since(m, c);
        expect(rows).toHaveLength(2);
        expect(rows[0]?.xact_id).not.toBe(rows[1]?.xact_id);
      } finally {
        await c.end();
      }
    });
  });

  it("AC16: a session's temporary audit_log does not divert its audit rows from public.audit_log", async () => {
    const c = await connection();
    try {
      await c.query("create temporary table audit_log (like public.audit_log including all)");
      // Read on the shared connection, where audit_log can only mean public.audit_log.
      const m = await mark();

      const id = await insertMember(c);

      expect(await since(m)).toEqual([expect.objectContaining({ table_name: "members", operation: "insert", row_key: { id } })]);
      expect((await c.query<{ n: number }>("select count(*)::int as n from pg_temp.audit_log")).rows).toEqual([{ n: 0 }]);
    } finally {
      await c.end();
    }
  });

  it("AC17: a role that does not own audit_row() is refused attaching it to a table it owns, and no audit row is written", async () => {
    const probe = `probe_${randomUUID().replace(/-/g, "")}`;
    const c = await connection();
    try {
      await c.query("begin");
      await c.query(`create role "${probe}"`);
      const m = await mark(c);

      await c.query(`set local session authorization "${probe}"`);
      await c.query("create temporary table probe_attach (id int primary key, note text)");
      let refused: unknown;
      await c.query("savepoint attach");
      try {
        await c.query(
          "create trigger audit after insert or update or delete on pg_temp.probe_attach for each row execute function public.audit_row()",
        );
      } catch (e) {
        refused = e;
        await c.query("rollback to savepoint attach");
      }
      await c.query("insert into pg_temp.probe_attach (id, note) values (1, 'a row of its choosing')");
      await c.query("reset session authorization");

      expect(refused).toMatchObject({ code: "42501" }); // insufficient_privilege
      expect(await since(m, c)).toEqual([]);
    } finally {
      await c.query("rollback").catch(() => undefined);
      await c.end();
    }
  });

  describe("AC18 — a table with a json column", () => {
    /** On its own connection, in a transaction always rolled back: a json table carrying the trigger, with one row. */
    const withJsonTable = async (body: (c: Client) => Promise<void>): Promise<void> => {
      const c = await connection();
      try {
        await c.query("begin");
        await c.query("create table probe_json (id int primary key, body json)");
        await c.query(
          "create trigger audit after insert or update or delete on probe_json for each row execute function audit_row()",
        );
        await c.query(`insert into probe_json (id, body) values (1, '{"a": 1}')`);
        await body(c);
      } finally {
        await c.query("rollback").catch(() => undefined);
        await c.end();
      }
    };

    it("AC18: updating the json column to a new value succeeds and writes one update row", async () => {
      await withJsonTable(async (c) => {
        const m = await mark(c);

        await expect(c.query(`update probe_json set body = '{"a": 2}' where id = 1`)).resolves.toMatchObject({
          rowCount: 1,
        });

        expect(await since(m, c)).toEqual([
          expect.objectContaining({
            table_name: "probe_json",
            operation: "update",
            row_key: { id: 1 },
            before: { id: 1, body: { a: 1 } },
            after: { id: 1, body: { a: 2 } },
          }),
        ]);
      });
    });

    it("AC18: updating a row with a json column to the values it already has succeeds and writes no audit row", async () => {
      await withJsonTable(async (c) => {
        const m = await mark(c);

        await expect(c.query("update probe_json set id = id, body = body where id = 1")).resolves.toMatchObject({
          rowCount: 1,
        });

        expect(await since(m, c)).toEqual([]);
      });
    });
  });
});
