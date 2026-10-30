// Issue 11 — the schema check. The AC9 exempt-list test needs no database. The rest run against a
// database of this suite's own, `<test db>_schema`, created if absent and migrated once with every
// file in db/migrations/. Without a reachable Postgres those skip locally and fail in CI (DEC-014).
//
// Each AC10–AC15 test builds scratch tables inside a transaction, calls `schemaViolations` on that
// same client, and rolls back, so nothing it creates outlives the test. Result order is
// unspecified: tests assert membership.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "../src/adapters/pg-connect.js";
import type { Client } from "../src/adapters/pg-connect.js";
import { ensureTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { migrate } from "./migrate.js";
import { AUDIT_EXEMPT, schemaViolations } from "./schema-check.js";
import type { SchemaViolation } from "./schema-check.js";

describe("AC9 — the exempt list", () => {
  it("AC9: AUDIT_EXEMPT holds exactly audit_log, _migrations, rate_limit_hits and sign_in_codes, each with a reason", () => {
    expect(Object.keys(AUDIT_EXEMPT).sort()).toEqual(["_migrations", "audit_log", "rate_limit_hits", "sign_in_codes"]);
    for (const [table, reason] of Object.entries(AUDIT_EXEMPT)) {
      expect(reason.trim(), table).not.toBe("");
    }
  });
});

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC9–AC15 — schemaViolations against <test db>_schema${skipped}`, () => {
  let db: Client;

  beforeAll(async () => {
    const url = await ensureTestDatabase(TEST_DATABASE_URL, "schema");
    await migrate(url);
    db = createClient(url);
    await db.connect();
  });

  afterAll(async () => {
    await db?.end();
  });

  /** Runs `setup`, then the check, inside a transaction that is always rolled back. */
  const check = async (setup: string, exempt?: Readonly<Record<string, string>>): Promise<SchemaViolation[]> => {
    await db.query("begin");
    try {
      await db.query(setup);
      return exempt === undefined ? await schemaViolations(db) : await schemaViolations(db, exempt);
    } finally {
      await db.query("rollback");
    }
  };

  const naming = (violations: SchemaViolation[], table: string) => violations.filter((v) => v.table === table);

  /** A row-level trigger calling audit_row() on `table`, with the given timing, events and level. */
  const auditTrigger = (table: string, timing = "after", events = "insert or update or delete", level = "row") =>
    `create trigger audit ${timing} ${events} on ${table} for each ${level} execute function audit_row();`;

  it("AC9: with every migration applied, schemaViolations with the default exempt list returns []", async () => {
    expect(await schemaViolations(db)).toEqual([]);
  });

  describe("AC10 — a table with no trigger calling audit_row", () => {
    it("AC10: a table with no trigger at all is missing-trigger", async () => {
      const result = await check("create table probe_bare (id int primary key);");
      expect(result).toContainEqual({ kind: "missing-trigger", table: "probe_bare" });
    });

    it("AC10: a table whose after-row insert/update/delete trigger calls another function is missing-trigger", async () => {
      const result = await check(`
        create function probe_noop() returns trigger language plpgsql as $$ begin return null; end $$;
        create table probe_other_fn (id int primary key);
        create trigger audit after insert or update or delete on probe_other_fn
          for each row execute function probe_noop();
      `);
      expect(result).toContainEqual({ kind: "missing-trigger", table: "probe_other_fn" });
    });

    it("AC10: a table named in the exempt list passed in is not missing-trigger", async () => {
      const result = await check("create table probe_exempted (id int primary key);", {
        ...AUDIT_EXEMPT,
        probe_exempted: "a test exemption",
      });
      expect(naming(result, "probe_exempted")).toEqual([]);
    });

    it("AC10: a view, and a table outside the public schema, are not checked", async () => {
      const result = await check(`
        create schema probe_schema;
        create table probe_schema.probe_elsewhere (id int);
        create view probe_view as select 1 as id;
      `);
      expect(naming(result, "probe_elsewhere")).toEqual([]);
      expect(naming(result, "probe_view")).toEqual([]);
    });
  });

  describe("AC11 — a table whose only audit_row trigger does not count", () => {
    const cases: Array<[string, string, string]> = [
      ["is disabled", "probe_disabled", `${auditTrigger("probe_disabled")} alter table probe_disabled disable trigger audit;`],
      ["fires once per statement", "probe_statement", auditTrigger("probe_statement", "after", undefined, "statement")],
      ["fires before the change", "probe_before", auditTrigger("probe_before", "before")],
      ["misses insert", "probe_no_insert", auditTrigger("probe_no_insert", "after", "update or delete")],
      ["misses update", "probe_no_update", auditTrigger("probe_no_update", "after", "insert or delete")],
      ["misses delete", "probe_no_delete", auditTrigger("probe_no_delete", "after", "insert or update")],
    ];

    it.each(cases)("AC11: a table whose only audit_row trigger %s is missing-trigger", async (_how, table, trigger) => {
      const result = await check(`create table ${table} (id int primary key); ${trigger}`);
      expect(result).toContainEqual({ kind: "missing-trigger", table });
    });

    it("AC11: a counting trigger named other than audit, or enabled always, is not missing-trigger", async () => {
      const result = await check(`
        create table probe_renamed (id int primary key);
        create trigger any_name_at_all after delete or insert or update on probe_renamed
          for each row execute function audit_row();
        create table probe_always (id int primary key);
        ${auditTrigger("probe_always")}
        alter table probe_always enable always trigger audit;
      `);
      expect(naming(result, "probe_renamed")).toEqual([]);
      expect(naming(result, "probe_always")).toEqual([]);
    });
  });

  describe("AC12 — a table with no primary key", () => {
    it("AC12: a table with no primary key is no-primary-key, and missing-trigger as well", async () => {
      const result = await check("create table probe_no_pk (id int);");
      expect(result).toContainEqual({ kind: "no-primary-key", table: "probe_no_pk" });
      expect(result).toContainEqual({ kind: "missing-trigger", table: "probe_no_pk" });
    });

    it("AC12: a table with no primary key named in the exempt list passed in is not no-primary-key", async () => {
      const result = await check("create table probe_no_pk_exempted (id int);", {
        ...AUDIT_EXEMPT,
        probe_no_pk_exempted: "a test exemption",
      });
      expect(naming(result, "probe_no_pk_exempted")).toEqual([]);
    });
  });

  describe("AC13 — an exemption naming no table", () => {
    it("AC13: an exempt list naming a table that does not exist is stale-exemption", async () => {
      const result = await check("select 1;", { ...AUDIT_EXEMPT, probe_gone: "a table that was dropped" });
      expect(result).toContainEqual({ kind: "stale-exemption", table: "probe_gone" });
    });
  });

  describe("AC14 — a timestamp without time zone column", () => {
    it("AC14: in an audited table, it is timestamp-without-time-zone naming the column", async () => {
      const result = await check(`
        create table probe_naive (id int primary key, seen timestamp, logged timestamp(3) without time zone);
      `);
      expect(result).toContainEqual({ kind: "timestamp-without-time-zone", table: "probe_naive", column: "seen" });
      expect(result).toContainEqual({ kind: "timestamp-without-time-zone", table: "probe_naive", column: "logged" });
    });

    it("AC14: in a table named in the exempt list passed in, it is still timestamp-without-time-zone", async () => {
      const result = await check("create table probe_naive_exempted (id int primary key, seen timestamp);", {
        ...AUDIT_EXEMPT,
        probe_naive_exempted: "a test exemption",
      });
      expect(result).toContainEqual({
        kind: "timestamp-without-time-zone",
        table: "probe_naive_exempted",
        column: "seen",
      });
    });

    it("AC14: in a view, or a table outside the public schema, it is not reported", async () => {
      const result = await check(`
        create schema probe_schema;
        create table probe_schema.probe_elsewhere (id int primary key, seen timestamp, seen_at text);
        create view probe_view as select localtimestamp::timestamp as seen, 'x'::text as seen_at;
      `);
      expect(naming(result, "probe_elsewhere")).toEqual([]);
      expect(naming(result, "probe_view")).toEqual([]);
    });
  });

  describe("AC15 — a time stored as text", () => {
    it("AC15: a text or varchar column ending in _at, _since, _until, _date or _time is time-as-text", async () => {
      const columns = ["paid_at", "member_since", "paused_until", "pickup_date", "cutoff_time", "sent_at"];
      const result = await check(`
        create table probe_text_times (
          id int primary key,
          paid_at text, member_since text, paused_until text, pickup_date text, cutoff_time text,
          sent_at varchar(40)
        );
      `);
      for (const column of columns) {
        expect(result).toContainEqual({ kind: "time-as-text", table: "probe_text_times", column });
      }
    });

    it("AC15: in a table named in the exempt list passed in, it is still time-as-text", async () => {
      const result = await check("create table probe_text_exempted (id int primary key, seen_at text);", {
        ...AUDIT_EXEMPT,
        probe_text_exempted: "a test exemption",
      });
      expect(result).toContainEqual({ kind: "time-as-text", table: "probe_text_exempted", column: "seen_at" });
    });

    it("AC15: a text column whose name only ends in the letters (format, candidate, overtime), and real time types, are not reported", async () => {
      const result = await check(`
        create table probe_lookalikes (
          id int primary key,
          format text, candidate text, overtime varchar(10),
          seen_at timestamptz, pickup_date date, cutoff_time time
        );
        ${auditTrigger("probe_lookalikes")}
      `);
      expect(naming(result, "probe_lookalikes")).toEqual([]);
    });
  });
});
