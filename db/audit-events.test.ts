// Issue 34 — audit_event() and the audit_log checks it writes under. Every test runs against a
// database of this suite's own, `<test db>_audit_events`, created if absent and migrated once with
// every file in db/migrations/. Without a reachable Postgres they skip locally and fail in CI (DEC-014).
//
// Each test reads only the audit rows written after the highest id it saw before acting, as
// db/audit-log.test.ts does.
//
// Issue 71 adds audit_event()'s fourth argument, `detail`, the actor every write carries through
// withActor, and the trigger row's actor, which only this Postgres suite can see.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "../src/adapters/pg-connect.js";
import type { Client } from "../src/adapters/pg-connect.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { AUDIT_EVENT_KINDS, type AuditEvent } from "../src/ports/repository.js";

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
  let repo: PostgresRepository;

  beforeAll(async () => {
    url = await migrateTestDatabase(TEST_DATABASE_URL, "audit_events");
    db = createClient(url);
    await db.connect();
    repo = new PostgresRepository(url);
  });

  afterAll(async () => {
    await repo?.close();
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

  /** audit_event() with its four arguments (issue 71); a null detail is passed as SQL null. */
  const recordEvent = (c: Client, event: string | null, tableName: string, rowKey: unknown, detail: unknown = null) =>
    c.query("select public.audit_event($1, $2, $3::jsonb, $4::jsonb)", [
      event,
      tableName,
      JSON.stringify(rowKey),
      detail === null ? null : JSON.stringify(detail),
    ]);

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
        await c.query(`grant execute on function public.audit_event(text, text, jsonb, jsonb) to "${probe}"`);
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

  // Issue 71 from here on.
  const email = (who: string) => `${who}-${randomUUID()}@example.com`;

  /** Each row after `m`, in id order: its detail, and whether that is SQL NULL rather than 'null'::jsonb. */
  const detailsSince = async (m: string): Promise<Array<{ operation: string; detail: unknown; sql_null: boolean }>> =>
    (
      await db.query<{ operation: string; detail: unknown; sql_null: boolean }>(
        "select operation, detail, detail is null as sql_null from audit_log where id > $1::bigint order by id",
        [m],
      )
    ).rows;

  describe("AC1 (issue 71) — a trigger row carries the actor withActor names", () => {
    it("AC1: a member created through withActor({ member }) writes its insert trigger row with actor member:<that member's id>", async () => {
      const admin = await repo.createMember({ email: email("admin") });
      const m = await mark();
      const created = await repo.withActor({ member: admin.id }, (r) => r.createMember({ email: email("ada") }));
      expect(await since(m)).toEqual([
        expect.objectContaining({ table_name: "members", operation: "insert", row_key: { id: created.id }, actor: `member:${admin.id}` }),
      ]);
    });
  });

  describe("AC3 (issue 71) — a withActor that throws leaves no audit_log row", () => {
    it("AC3: createMember, then recordEvent, then a throw — no trigger row and no event row remain", async () => {
      const admin = await repo.createMember({ email: email("admin") });
      const m = await mark();
      const failure = new Error("fn failed after two writes");
      await expect(
        repo.withActor({ member: admin.id }, async (r) => {
          const grace = await r.createMember({ email: email("grace") });
          await r.recordEvent({ kind: "lock", memberId: grace.id });
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(await since(m)).toEqual([]);
    });
  });

  describe("AC4 (issue 71) — how audit_log.actor stores an actor", () => {
    it("AC4: withActor({ member }) stores the event row's actor as member:<uuid>", async () => {
      const ada = await repo.createMember({ email: email("ada") });
      const m = await mark();
      await repo.withActor({ member: ada.id }, (r) => r.recordEvent({ kind: "sign_in_by_code", memberId: ada.id }));
      expect(await since(m)).toEqual([expect.objectContaining({ operation: "event", event: "sign_in_by_code", actor: `member:${ada.id}` })]);
    });

    it("AC4: withActor({ system }) stores the event row's actor as system:<name>", async () => {
      const ada = await repo.createMember({ email: email("ada") });
      const m = await mark();
      await repo.withActor({ system: "charge-run" }, (r) => r.recordEvent({ kind: "lock", memberId: ada.id }));
      expect(await since(m)).toEqual([expect.objectContaining({ operation: "event", event: "lock", actor: "system:charge-run" })]);
    });

    it("AC4: withActor(null) stores the event row's actor as SQL null, not ''", async () => {
      const ada = await repo.createMember({ email: email("ada") });
      const m = await mark();
      await repo.withActor(null, (r) => r.recordEvent({ kind: "lock", memberId: ada.id }));
      expect(await since(m)).toEqual([expect.objectContaining({ operation: "event", event: "lock", actor: null })]);
    });
  });

  describe("AC6 (issue 71) — audit_log.detail", () => {
    it("AC6: audit_event()'s fourth argument is stored in audit_log.detail", async () => {
      const m = await mark();
      await recordEvent(db, "lock", "members", memberKey(), { duplicates: 2 });
      expect(await detailsSince(m)).toEqual([{ operation: "event", detail: { duplicates: 2 }, sql_null: false }]);
    });

    it("AC6: a SQL null fourth argument is stored as SQL NULL, not 'null'::jsonb", async () => {
      const m = await mark();
      await recordEvent(db, "lock", "members", memberKey(), null);
      expect(await detailsSince(m)).toEqual([{ operation: "event", detail: null, sql_null: true }]);
    });

    it("AC6: a trigger row's detail is SQL NULL — a member's insert and update", async () => {
      const m = await mark();
      const ada = await repo.createMember({ email: email("ada") });
      await db.query("update members set language = 'es' where id = $1", [ada.id]);
      expect(await detailsSince(m)).toEqual([
        { operation: "insert", detail: null, sql_null: true },
        { operation: "update", detail: null, sql_null: true },
      ]);
    });

    it.each<[string, (memberId: string) => AuditEvent]>([
      ["sign_in_by_code", (memberId) => ({ kind: "sign_in_by_code", memberId })],
      ["sign_in_by_link", (memberId) => ({ kind: "sign_in_by_link", memberId })],
      ["lock", (memberId) => ({ kind: "lock", memberId })],
      [
        "rate_limit_refusal",
        () => ({ kind: "rate_limit_refusal", bucket: "sign-in-request", key: "203.0.113.7", windowStart: new Date("2026-10-28T14:00:00.000Z") }),
      ],
    ])("AC6: the %s event row PostgresRepository.recordEvent writes has a SQL NULL detail", async (_kind, event) => {
      const ada = await repo.createMember({ email: email("ada") });
      const m = await mark();
      await repo.recordEvent(event(ada.id));
      expect(await detailsSince(m)).toEqual([{ operation: "event", detail: null, sql_null: true }]);
    });
  });

  describe("AC7 (issue 71) — the four-argument audit_event() replaces the three-argument one", () => {
    it("AC7: audit_event(text, text, jsonb) no longer exists", async () => {
      const { rows } = await db.query<{ gone: boolean }>("select to_regprocedure('public.audit_event(text,text,jsonb)') is null as gone");
      expect(rows).toEqual([{ gone: true }]);
    });

    it("AC7: audit_event(text, text, jsonb, jsonb) is security definer, runs with search_path pg_catalog, pg_temp, and PUBLIC cannot execute it", async () => {
      const { rows } = await db.query<{ definer: boolean; config: string[] | null; public_execute: boolean }>(
        `select p.prosecdef as definer,
                p.proconfig as config,
                coalesce((select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
                            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), false) as public_execute
           from pg_proc p
          where p.oid = to_regprocedure('public.audit_event(text,text,jsonb,jsonb)')`,
      );
      expect(rows).toEqual([{ definer: true, config: ["search_path=pg_catalog, pg_temp"], public_execute: false }]);
    });
  });
});
