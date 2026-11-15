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
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { APP_RIGHTS_EXCEPTIONS, AUDIT_EXEMPT, schemaViolations } from "./schema-check.js";
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
    const url = await migrateTestDatabase(TEST_DATABASE_URL, "schema");
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
      // [how it fails to count, table, the trigger SQL run after `create table <table> (id int primary key)`]
      ["is disabled", "probe_disabled", `${auditTrigger("probe_disabled")} alter table probe_disabled disable trigger audit;`],
      ["fires once per statement", "probe_statement", auditTrigger("probe_statement", "after", undefined, "statement")],
      ["fires before the change", "probe_before", auditTrigger("probe_before", "before")],
      ["misses insert", "probe_no_insert", auditTrigger("probe_no_insert", "after", "update or delete")],
      ["misses update", "probe_no_update", auditTrigger("probe_no_update", "after", "insert or delete")],
      ["misses delete", "probe_no_delete", auditTrigger("probe_no_delete", "after", "insert or update")],
      [
        "carries a WHEN condition",
        "probe_when",
        `create trigger audit after insert or update or delete on probe_when
           for each row when (pg_trigger_depth() < 1) execute function audit_row();`,
      ],
      [
        "fires on update of only some columns",
        "probe_update_of",
        `alter table probe_update_of add column note text;
         ${auditTrigger("probe_update_of", "after", "insert or update of note or delete")}`,
      ],
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

// Issue 185, AC8 — the schema check on haul_app's rights. The list test needs no database; the rest
// run against the same `<test db>_schema`, each building what it needs inside a transaction it rolls
// back, as above. Calls pass both lists, so a test can pass a rights list of its own.
type AppRights = Readonly<Record<string, { rights: readonly string[]; reason: string }>>;

describe("AC8 (issue 185) — the app-rights exception list", () => {
  it("AC8: APP_RIGHTS_EXCEPTIONS holds exactly audit_log (SELECT) and _migrations (nothing), each with a reason, rights in upper case", () => {
    expect(Object.keys(APP_RIGHTS_EXCEPTIONS).sort()).toEqual(["_migrations", "audit_log"]);
    expect(APP_RIGHTS_EXCEPTIONS.audit_log?.rights).toEqual(["SELECT"]);
    expect(APP_RIGHTS_EXCEPTIONS._migrations?.rights).toEqual([]);
    for (const [table, { rights, reason }] of Object.entries(APP_RIGHTS_EXCEPTIONS)) {
      expect(reason.trim(), table).not.toBe("");
      for (const right of rights) expect(right, table).toBe(right.toUpperCase());
    }
  });
});

describe.skipIf(!up)(`AC8 (issue 185) — schemaViolations on haul_app's rights, against <test db>_schema${skipped}`, () => {
  let db: Client;

  beforeAll(async () => {
    const url = await migrateTestDatabase(TEST_DATABASE_URL, "schema");
    db = createClient(url);
    await db.connect();
  });

  afterAll(async () => {
    await db?.end();
  });

  /** Runs `setup`, then the check with both lists, inside a transaction that is always rolled back. */
  const check = async (setup: string, appRights: AppRights = APP_RIGHTS_EXCEPTIONS): Promise<SchemaViolation[]> => {
    await db.query("begin");
    try {
      await db.query(setup);
      return await schemaViolations(db, AUDIT_EXEMPT, appRights);
    } finally {
      await db.query("rollback");
    }
  };

  const ofKind = (violations: SchemaViolation[], kind: string, table: string) =>
    violations.filter((v) => v.kind === kind && v.table === table);

  /** A probe table on which haul_app holds exactly `rights` (SQL privilege names, comma-separated). */
  const probeWithRights = (table: string, rights: string) => `
    create table ${table} (id int primary key);
    revoke all on ${table} from haul_app;
    grant ${rights} on ${table} to haul_app;`;

  it("AC8: with every migration applied, schemaViolations with the default lists returns []", async () => {
    expect(await schemaViolations(db)).toEqual([]);
  });

  describe("AC8 — app-rights: haul_app's rights on a table differ from the expected set", () => {
    it("AC8: a table on which haul_app lacks DELETE is app-rights", async () => {
      const result = await check(probeWithRights("probe_app_short", "select, insert, update"));
      expect(result).toContainEqual({ kind: "app-rights", table: "probe_app_short" });
    });

    it("AC8: a table on which haul_app also holds TRUNCATE is app-rights", async () => {
      const result = await check(probeWithRights("probe_app_extra", "select, insert, update, delete, truncate"));
      expect(result).toContainEqual({ kind: "app-rights", table: "probe_app_extra" });
    });

    it("AC8: a table on which haul_app holds exactly the four is not app-rights", async () => {
      const result = await check(probeWithRights("probe_app_exact", "select, insert, update, delete"));
      expect(ofKind(result, "app-rights", "probe_app_exact")).toEqual([]);
    });

    it("AC8: haul_app holding INSERT on audit_log, whose entry says SELECT, is app-rights", async () => {
      const result = await check("grant insert on audit_log to haul_app;");
      expect(result).toContainEqual({ kind: "app-rights", table: "audit_log" });
    });

    it("AC8: a table in the rights list passed in is checked against its entry: SELECT alone passes, the four do not", async () => {
      const appRights: AppRights = {
        ...APP_RIGHTS_EXCEPTIONS,
        probe_app_ro: { rights: ["SELECT"], reason: "a test entry" },
        probe_app_ro_wide: { rights: ["SELECT"], reason: "a test entry" },
      };
      const result = await check(
        `${probeWithRights("probe_app_ro", "select")} ${probeWithRights("probe_app_ro_wide", "select, insert, update, delete")}`,
        appRights,
      );
      expect(ofKind(result, "app-rights", "probe_app_ro")).toEqual([]);
      expect(result).toContainEqual({ kind: "app-rights", table: "probe_app_ro_wide" });
    });
  });

  describe("AC8 — stale-rights-exception: an entry naming no table", () => {
    it("AC8: a rights list naming a table that does not exist is stale-rights-exception", async () => {
      const result = await check("select 1;", { ...APP_RIGHTS_EXCEPTIONS, probe_app_gone: { rights: [], reason: "a dropped table" } });
      expect(result).toContainEqual({ kind: "stale-rights-exception", table: "probe_app_gone" });
    });
  });

  describe("AC8 — public-rights: PUBLIC holds a table right in public", () => {
    it("AC8: PUBLIC holding SELECT on a table is public-rights", async () => {
      const result = await check("create table probe_app_public (id int primary key); grant select on probe_app_public to public;");
      expect(result).toContainEqual({ kind: "public-rights", table: "probe_app_public" });
    });

    it("AC8: PUBLIC holding INSERT on audit_log is public-rights", async () => {
      const result = await check("grant insert on audit_log to public;");
      expect(result).toContainEqual({ kind: "public-rights", table: "audit_log" });
    });
  });

  describe("AC8 — public-execute: PUBLIC can execute an audit function", () => {
    it.each([
      ["audit_row", "audit_row()"],
      ["audit_event", "audit_event(text, text, jsonb, jsonb)"],
    ])("AC8: PUBLIC holding EXECUTE on %s is public-execute naming the function", async (name, signature) => {
      const result = await check(`grant execute on function public.${signature} to public;`);
      expect(result).toContainEqual({ kind: "public-execute", table: name });
    });
  });

  describe("AC8 — app-role-powers: haul_app holds a power it must not", () => {
    it.each(["superuser", "createrole", "bypassrls"])("AC8: haul_app with %s is app-role-powers, detail naming the power", async (power) => {
      const result = await check(`alter role haul_app ${power};`);
      expect(result).toContainEqual({ kind: "app-role-powers", table: "haul_app", detail: power });
    });

    it("AC8: haul_app as a member of another role is app-role-powers, detail `member of <role>`", async () => {
      const result = await check("create role probe_app_group nologin; grant probe_app_group to haul_app;");
      expect(result).toContainEqual({ kind: "app-role-powers", table: "haul_app", detail: "member of probe_app_group" });
    });

    it("AC8: haul_app owning a table, and owning a function, is app-role-powers for each, detail `owns <object>`", async () => {
      const result = await check(`
        create table probe_app_owned_table (id int primary key);
        alter table probe_app_owned_table owner to haul_app;
        create function probe_app_owned_fn() returns int language sql as 'select 1';
        alter function probe_app_owned_fn() owner to haul_app;
      `);
      expect(result).toContainEqual({
        kind: "app-role-powers",
        table: "haul_app",
        detail: expect.stringMatching(/^owns .*\bprobe_app_owned_table\b/),
      });
      expect(result).toContainEqual({
        kind: "app-role-powers",
        table: "haul_app",
        detail: expect.stringMatching(/^owns .*\bprobe_app_owned_fn\b/),
      });
    });
  });

  describe("AC8 — missing-default-privileges: future tables would not get the four", () => {
    it.each([
      ["all four revoked", "select, insert, update, delete"],
      ["DELETE alone revoked", "delete"],
    ])("AC8: with the default privileges for haul_app's tables %s, it is missing-default-privileges naming public", async (_what, revoked) => {
      const result = await check(`alter default privileges in schema public revoke ${revoked} on tables from haul_app;`);
      expect(result).toContainEqual({ kind: "missing-default-privileges", table: "public" });
    });
  });
});
