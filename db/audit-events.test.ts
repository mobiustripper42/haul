// Issue 34 — audit_event() and the audit_log checks it writes under. Every test runs against a
// database of this suite's own, `<test db>_audit_events`, created if absent and migrated once with
// every file in db/migrations/. Without a reachable Postgres they skip locally and fail in CI (DEC-014).
//
// Each test reads only the audit rows written after the highest id it saw before acting, as
// db/audit-log.test.ts does.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "../src/adapters/pg-connect.js";
import type { Client } from "../src/adapters/pg-connect.js";
import { ensureTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { AUDIT_EVENT_KINDS } from "../src/ports/repository.js";
import { migrate } from "./migrate.js";

type EventRow = {
  table_name: string;
  operation: string;
  event: string | null;
  row_key: unknown;
  before: unknown;
  after: unknown;
  actor: string | null;
  db_user: string;
};

const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`issue 34 — audit_event() against <test db>_audit_events${skipped}`, () => {
  let url: string;
  let db: Client;

  beforeAll(async () => {
    url = await ensureTestDatabase(TEST_DATABASE_URL, "audit_events");
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

  /** The highest audit_log id so far: the rows after it are the ones a test is about to write. */
  const mark = async (c: Client = db): Promise<string> =>
    (await c.query<{ n: string }>("select coalesce(max(id), 0)::text as n from audit_log")).rows[0]?.n ?? "0";

  const since = async (m: string, c: Client = db): Promise<EventRow[]> =>
    (
      await c.query<EventRow>(
        `select table_name, operation, event, row_key, before, after, actor, db_user
           from audit_log where audit_log.id > $1::bigint order by audit_log.id`,
        [m],
      )
    ).rows;

  const memberKey = () => ({ id: randomUUID() });

  const recordEvent = (c: Client, event: string | null, tableName: string, rowKey: unknown) =>
    c.query("select public.audit_event($1, $2, $3::jsonb)", [event, tableName, JSON.stringify(rowKey)]);

  /** A raw insert into audit_log, as the table's owner, naming the operation and the event. */
  const rawInsert = (operation: string, event: string | null) =>
    db.query(
      "insert into audit_log (table_name, operation, event, row_key, db_user) values ('members', $1, $2, $3::jsonb, 'probe')",
      [operation, event, JSON.stringify(memberKey())],
    );

  describe("AC6 — an event row", () => {
    it("AC6: audit_event() writes one row — operation 'event', the event's name, the table and row_key given, before and after null, db_user the session user", async () => {
      const key = memberKey();
      const m = await mark();
      await recordEvent(db, "sign_in_by_code", "members", key);
      const user = (await db.query<{ u: string }>("select session_user::text as u")).rows[0]?.u;

      expect(await since(m)).toEqual([
        {
          table_name: "members",
          operation: "event",
          event: "sign_in_by_code",
          row_key: key,
          before: null,
          after: null,
          actor: null,
          db_user: user,
        },
      ]);
    });

    it("AC6: inside a transaction that set haul.actor, the event row carries that actor", async () => {
      const actor = `admin:${randomUUID()}`;
      const c = await connection();
      try {
        const m = await mark(c);
        await c.query("begin");
        await c.query("select set_config('haul.actor', $1, true)", [actor]);
        await recordEvent(c, "lock", "members", memberKey());
        await c.query("commit");

        expect(await since(m, c)).toEqual([expect.objectContaining({ operation: "event", event: "lock", actor })]);
      } finally {
        await c.end();
      }
    });

    it("AC6: a later transaction on the same connection that sets no actor writes actor null, not '' and not the earlier one", async () => {
      const c = await connection();
      try {
        await c.query("begin");
        await c.query("select set_config('haul.actor', $1, true)", [`admin:${randomUUID()}`]);
        await recordEvent(c, "lock", "members", memberKey());
        await c.query("commit");
        // The trap this guards: once set in a session, the setting reads back as '' rather than null.
        expect((await c.query<{ v: string | null }>("select current_setting('haul.actor', true) as v")).rows).toEqual([
          { v: "" },
        ]);

        const m = await mark(c);
        await c.query("begin");
        await recordEvent(c, "sign_in_by_link", "members", memberKey());
        await c.query("commit");

        expect(await since(m, c)).toEqual([expect.objectContaining({ event: "sign_in_by_link", actor: null })]);
      } finally {
        await c.end();
      }
    });

    it("AC6: db_user is session_user — a role granted EXECUTE, with no rights on audit_log, is recorded as itself", async () => {
      const probe = `probe_${randomUUID().replace(/-/g, "")}`;
      const c = await connection();
      try {
        await c.query("begin");
        await c.query(`create role "${probe}"`);
        await c.query(`grant execute on function public.audit_event(text, text, jsonb) to "${probe}"`);
        const m = await mark(c);

        await c.query(`set local session authorization "${probe}"`);
        await recordEvent(c, "lock", "members", memberKey());
        await c.query("reset session authorization");

        expect(await since(m, c)).toEqual([expect.objectContaining({ operation: "event", event: "lock", db_user: probe })]);
      } finally {
        await c.query("rollback").catch(() => undefined);
        await c.end();
      }
    });
  });

  describe("AC8 — audit_event() writes event rows only, under the table's checks", () => {
    // The SQL check and AUDIT_EVENT_KINDS cannot share a home; this holds them together.
    it.each([...AUDIT_EVENT_KINDS])("AC8: audit_event() accepts every kind in AUDIT_EVENT_KINDS — %j", async (kind) => {
      const m = await mark();
      await recordEvent(db, kind, "members", memberKey());
      expect(await since(m)).toEqual([expect.objectContaining({ operation: "event", event: kind })]);
    });

    it.each(["truncate", "Event"])("AC8: a raw insert with operation %j is refused with a check violation", async (operation) => {
      const m = await mark();
      await expect(rawInsert(operation, null)).rejects.toMatchObject({ code: CHECK_VIOLATION });
      expect(await since(m)).toEqual([]);
    });

    it("AC8: a raw 'event' row with no event name is refused with a check violation", async () => {
      const m = await mark();
      await expect(rawInsert("event", null)).rejects.toMatchObject({ code: CHECK_VIOLATION });
      expect(await since(m)).toEqual([]);
    });

    it.each(["insert", "update", "delete"])("AC8: a raw %j row carrying an event name is refused with a check violation", async (operation) => {
      const m = await mark();
      await expect(rawInsert(operation, "lock")).rejects.toMatchObject({ code: CHECK_VIOLATION });
      expect(await since(m)).toEqual([]);
    });

    it("AC8: a raw 'event' row with a name not on the list is refused with a check violation", async () => {
      const m = await mark();
      await expect(rawInsert("event", "sign_out")).rejects.toMatchObject({ code: CHECK_VIOLATION });
      expect(await since(m)).toEqual([]);
    });

    it("AC8: audit_event() with a name not on the list is refused with a check violation and writes no row", async () => {
      const m = await mark();
      await expect(recordEvent(db, "sign_out", "members", memberKey())).rejects.toMatchObject({ code: CHECK_VIOLATION });
      expect(await since(m)).toEqual([]);
    });
  });

  it("AC9: a role with no EXECUTE grant is refused calling audit_event() with 42501, and no row is written", async () => {
    const probe = `probe_${randomUUID().replace(/-/g, "")}`;
    const c = await connection();
    try {
      await c.query("begin");
      await c.query(`create role "${probe}"`);
      const m = await mark(c);

      await c.query(`set local session authorization "${probe}"`);
      let refused: unknown;
      await c.query("savepoint call");
      try {
        await recordEvent(c, "lock", "members", memberKey());
      } catch (e) {
        refused = e;
        await c.query("rollback to savepoint call");
      }
      await c.query("reset session authorization");

      expect(refused).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      expect(await since(m, c)).toEqual([]);
    } finally {
      await c.query("rollback").catch(() => undefined);
      await c.end();
    }
  });
});
