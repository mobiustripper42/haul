// Issue 185 — the app's database role, haul_app, and what the app-role migration grants it. Every
// test runs against a database of this suite's own, `<test db>_app_role`, created if absent and
// migrated once with every file in db/migrations/; AC10 rebuilds two more of its own. Without a
// reachable Postgres they skip locally and fail in CI (DEC-014).
//
// The role is cluster-wide. A test that needs it absent, or made by hand, renames the real one aside
// inside a transaction it rolls back, so no other suite ever sees the change. The migration is found
// by the glob db/migrations/*_app_role.sql and its text run through a `pg` client in one simple
// query, as psql sends it.
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "../src/adapters/pg-connect.js";
import type { Client } from "../src/adapters/pg-connect.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL, testDatabaseUrl } from "../src/adapters/test-database.js";
import { MIGRATIONS_DIR } from "./migrate.js";
import { rebuildDatabase } from "./rebuild.js";
import { APP_RIGHTS_EXCEPTIONS } from "./schema-check.js";

const INSUFFICIENT_PRIVILEGE = "42501";
const THE_FOUR = ["DELETE", "INSERT", "SELECT", "UPDATE"]; // sorted, as rightsOf returns them

/** The text of the one migration matching db/migrations/*_app_role.sql. */
async function appRoleMigrationSql(): Promise<string> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith("_app_role.sql"));
  expect(files, "exactly one db/migrations/*_app_role.sql").toHaveLength(1);
  return readFile(join(MIGRATIONS_DIR, files[0] as string), "utf8");
}

/** Renames an existing haul_app aside. Run inside a transaction that is rolled back. */
const RENAME_ASIDE = `
  do $$ begin
    if exists (select from pg_roles where rolname = 'haul_app') then
      alter role haul_app rename to haul_app_aside_issue_185;
    end if;
  end $$;`;

/**
 * haul_app's rights on each relation in public of the given relkinds, sorted, as aclexplode names
 * them. A relation it holds nothing on is listed with []. Without a haul_app, every list is [].
 */
async function rightsOf(c: Client, relkinds: string[]): Promise<Record<string, string[]>> {
  const { rows } = await c.query<{ relname: string; rights: string[] }>(
    `select c.relname,
            coalesce(array_agg(a.privilege_type::text order by a.privilege_type) filter (where a.privilege_type is not null),
                     '{}') as rights
       from pg_class c
       left join lateral aclexplode(c.relacl) a on a.grantee = (select oid from pg_roles where rolname = 'haul_app')
      where c.relnamespace = 'public'::regnamespace and c.relkind = any ($1)
      group by c.relname`,
    [relkinds],
  );
  return Object.fromEntries(rows.map((r) => [r.relname, r.rights]));
}

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`issue 185 — haul_app against <test db>_app_role${skipped}`, () => {
  let db: Client;

  beforeAll(async () => {
    const url = await migrateTestDatabase(TEST_DATABASE_URL, "app_role");
    db = createClient(url);
    await db.connect();
  });

  afterAll(async () => {
    await db?.end();
  });

  /** Runs `fn` on the suite's client inside a transaction that is always rolled back. */
  const rolledBack = async <T>(fn: () => Promise<T>): Promise<T> => {
    await db.query("begin");
    try {
      return await fn();
    } finally {
      await db.query("rollback");
    }
  };

  /** Runs `fn` as haul_app — `set local role` — inside a transaction that is always rolled back. */
  const asApp = <T>(fn: () => Promise<T>): Promise<T> =>
    rolledBack(async () => {
      await db.query("set local role haul_app");
      return fn();
    });

  /** The SQLSTATE `sql` fails with as haul_app, or undefined when it succeeds. */
  const refusalAsApp = async (sql: string): Promise<string | undefined> => {
    try {
      await asApp(() => db.query(sql));
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    }
    return undefined;
  };

  describe("AC1 — the migration creates haul_app when it is absent", () => {
    it("AC1: given no haul_app role, running the migration's SQL creates haul_app, and it cannot log in", async () => {
      const sql = await appRoleMigrationSql();
      const after = await rolledBack(async () => {
        await db.query(RENAME_ASIDE);
        const before = await db.query("select 1 from pg_roles where rolname = 'haul_app'");
        expect(before.rows, "haul_app is absent before the migration runs").toEqual([]);
        await db.query(sql);
        return (await db.query<{ rolcanlogin: boolean }>("select rolcanlogin from pg_roles where rolname = 'haul_app'")).rows;
      });
      expect(after).toEqual([{ rolcanlogin: false }]);
    });
  });

  describe("AC2 — the migration leaves a hand-made haul_app's login alone", () => {
    it("AC2: given haul_app created by hand with a login and password, running the migration's SQL leaves its login and password unchanged", async () => {
      const sql = await appRoleMigrationSql();
      const { before, after } = await rolledBack(async () => {
        await db.query(RENAME_ASIDE);
        await db.query("create role haul_app login password 'issue-185-made-by-hand'");
        const read = async () =>
          (await db.query<{ rolcanlogin: boolean; rolpassword: string | null }>(
            "select rolcanlogin, rolpassword from pg_authid where rolname = 'haul_app'",
          )).rows;
        const before = await read();
        await db.query(sql);
        return { before, after: await read() };
      });
      expect(before).toEqual([{ rolcanlogin: true, rolpassword: expect.any(String) }]);
      expect(after).toEqual(before);
    });

    // Production's migrating user owns the objects but need not hold CREATEROLE. The probe role here is
    // a member of the role that owns public's tables, so it holds every right the grants need, and lacks
    // CREATEROLE, which is never inherited: the role step is the only one its missing power can fail.
    it("AC2: given haul_app created by hand, a migrating user without CREATEROLE runs the migration's SQL without error", async () => {
      const sql = await appRoleMigrationSql();
      const { canCreateRole, refusal, members } = await rolledBack(async () => {
        await db.query(RENAME_ASIDE);
        await db.query("create role haul_app login password 'issue-185-made-by-hand'");
        const owner = (await db.query<{ owner: string }>("select relowner::regrole::text as owner from pg_class where oid = 'public.members'::regclass")).rows[0]?.owner;
        await db.query("create role haul_migrator_issue_185 nologin nocreaterole");
        await db.query(`grant ${owner} to haul_migrator_issue_185`);
        await db.query("set local role haul_migrator_issue_185");
        const canCreateRole = (await db.query<{ rolcreaterole: boolean }>("select rolcreaterole from pg_roles where rolname = current_user")).rows[0]?.rolcreaterole;
        let refusal: string | undefined;
        await db.query("savepoint migration");
        try {
          await db.query(sql);
        } catch (e) {
          refusal = `${(e as { code?: string }).code}: ${(e as Error).message}`;
          await db.query("rollback to savepoint migration");
        }
        return { canCreateRole, refusal, members: (await rightsOf(db, ["r"])).members };
      });
      expect(canCreateRole, "the migrating user lacks CREATEROLE").toBe(false);
      expect(refusal).toBeUndefined();
      expect(members, "the migration ran to its grants").toEqual(THE_FOUR);
    });
  });

  describe("AC3 — exactly the four on every table but the exceptions", () => {
    it("AC3: haul_app holds exactly SELECT, INSERT, UPDATE and DELETE on every table in public not in APP_RIGHTS_EXCEPTIONS", async () => {
      const rights = await rightsOf(db, ["r", "p"]);
      const checked = Object.keys(rights).filter((table) => !Object.hasOwn(APP_RIGHTS_EXCEPTIONS, table));
      expect(checked).toContain("members");
      expect(checked).toContain("ledger");
      const wrong = Object.fromEntries(checked.filter((t) => JSON.stringify(rights[t]) !== JSON.stringify(THE_FOUR)).map((t) => [t, rights[t]]));
      expect(wrong, "tables whose haul_app rights are not exactly the four").toEqual({});
    });
  });

  describe("AC4 — the audit log and the migration ledger", () => {
    it("AC4: haul_app holds SELECT only on audit_log", async () => {
      expect((await rightsOf(db, ["r"])).audit_log).toEqual(["SELECT"]);
    });

    it("AC4: haul_app holds nothing on _migrations", async () => {
      // Partner of the audit_log test above: without a haul_app this list is empty too.
      expect((await rightsOf(db, ["r"]))._migrations).toEqual([]);
    });
  });

  describe("AC5 — the audit functions", () => {
    const canExecute = async (signature: string): Promise<boolean | null> =>
      (
        await db.query<{ can: boolean | null }>(
          `select (select has_function_privilege(r.oid, $1, 'EXECUTE') from pg_roles r where r.rolname = 'haul_app') as can`,
          [signature],
        )
      ).rows[0]?.can ?? null;

    it("AC5: haul_app can execute audit_event(text, text, jsonb, jsonb)", async () => {
      expect(await canExecute("public.audit_event(text, text, jsonb, jsonb)")).toBe(true);
    });

    it("AC5: haul_app cannot execute audit_row() directly", async () => {
      expect(await canExecute("public.audit_row()")).toBe(false);
    });
  });

  describe("AC6 — a table and a sequence a later migration makes, with no grant line", () => {
    it("AC6: a table created later by the migrations' user gets haul_app's four", async () => {
      const rights = await rolledBack(async () => {
        await db.query("create table probe_later_table (id uuid primary key default gen_random_uuid(), note text)");
        return rightsOf(db, ["r"]);
      });
      expect(rights.probe_later_table).toEqual(THE_FOUR);
    });

    it("AC6: a sequence created later, standalone or behind a serial column, gets USAGE only for haul_app", async () => {
      const rights = await rolledBack(async () => {
        await db.query(`
          create sequence probe_later_seq;
          create table probe_later_serial (id serial primary key);
        `);
        return rightsOf(db, ["S"]);
      });
      expect(rights.probe_later_seq).toEqual(["USAGE"]);
      expect(rights.probe_later_serial_id_seq).toEqual(["USAGE"]);
    });
  });

  describe("AC7 — what haul_app can and cannot do", () => {
    it("AC7: as haul_app, insert, update and delete on members succeed and each writes its audit_log row through the trigger", async () => {
      const rows = await asApp(async () => {
        const mark = (await db.query<{ id: string }>("select coalesce(max(id), 0)::text as id from audit_log")).rows[0]?.id;
        const email = `issue-185-${randomUUID()}@example.com`;
        const id = (await db.query<{ id: string }>("insert into members (email) values ($1) returning id", [email])).rows[0]?.id;
        await db.query("update members set language = 'es' where id = $1", [id]);
        await db.query("delete from members where id = $1", [id]);
        const written = await db.query<{ table_name: string; operation: string; row_key: unknown }>(
          "select table_name, operation, row_key from audit_log where id > $1::bigint order by id",
          [mark],
        );
        return { id, rows: written.rows };
      });
      expect(rows.rows).toEqual([
        { table_name: "members", operation: "insert", row_key: { id: rows.id } },
        { table_name: "members", operation: "update", row_key: { id: rows.id } },
        { table_name: "members", operation: "delete", row_key: { id: rows.id } },
      ]);
    });

    it("AC7: as haul_app, an audit_event() call writes its event row", async () => {
      const key = randomUUID();
      const rows = await asApp(async () => {
        await db.query("select audit_event('lock', 'members', jsonb_build_object('id', $1::text), null)", [key]);
        return (
          await db.query<{ operation: string; event: string; table_name: string }>(
            "select operation, event, table_name from audit_log where row_key = jsonb_build_object('id', $1::text)",
            [key],
          )
        ).rows;
      });
      expect(rows).toEqual([{ operation: "event", event: "lock", table_name: "members" }]);
    });

    it("AC7: as haul_app, select on audit_log succeeds", async () => {
      expect(await refusalAsApp("select id, table_name, operation from audit_log limit 1")).toBeUndefined();
    });

    it.each([
      ["insert into", "insert into audit_log (table_name, operation, row_key, db_user) values ('members', 'insert', '{}', 'haul_app')"],
      ["update on", "update audit_log set actor = 'system:issue-185'"],
      ["delete from", "delete from audit_log"],
      ["truncate on", "truncate audit_log"],
    ])("AC7: as haul_app, %s audit_log is refused with 42501", async (_what, sql) => {
      expect(await refusalAsApp(sql)).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("AC7: as haul_app, truncate on a business table is refused with 42501", async () => {
      expect(await refusalAsApp("truncate members cascade")).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("AC7: as haul_app, create table in public is refused with 42501", async () => {
      expect(await refusalAsApp("create table public.probe_made_by_app (id int primary key)")).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  describe("AC10 — two migrations at once, each on its own database", () => {
    it(
      "AC10: rebuilding two databases at once on one server, both migrations succeed and each grants haul_app the four",
      async () => {
        const urls = ["app_role_race_a", "app_role_race_b"].map((suffix) => testDatabaseUrl(TEST_DATABASE_URL, suffix));
        const results = await Promise.allSettled(urls.map((url) => rebuildDatabase(url)));
        expect(results.map((r) => (r.status === "rejected" ? String(r.reason) : "ok"))).toEqual(["ok", "ok"]);

        for (const url of urls) {
          const c = createClient(url);
          await c.connect();
          try {
            expect((await rightsOf(c, ["r"])).members, url).toEqual(THE_FOUR);
          } finally {
            await c.end();
          }
        }
      },
      60_000,
    );
  });

  describe("AC11 — the migration re-runs by hand", () => {
    /** Every grant on public's relations, functions and schema, and every default privilege, as text. */
    const grants = async (): Promise<string[]> =>
      (
        await db.query<{ line: string }>(`
          with g as (
            select 'relation ' || c.relname as object, a.grantee, a.privilege_type
              from pg_class c, aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace
            union all
            select 'function ' || p.oid::regprocedure::text, a.grantee, a.privilege_type
              from pg_proc p, aclexplode(p.proacl) a where p.pronamespace = 'public'::regnamespace
            union all
            select 'schema ' || n.nspname, a.grantee, a.privilege_type
              from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'public'
            union all
            select 'default ' || d.defaclobjtype::text || ' by ' || d.defaclrole::regrole::text || ' in ' || coalesce(d.defaclnamespace::regnamespace::text, '*'),
                   a.grantee, a.privilege_type
              from pg_default_acl d, aclexplode(d.defaclacl) a
          )
          select object || ' to ' || case when grantee = 0 then 'PUBLIC' else grantee::regrole::text end || ': ' || privilege_type as line
            from g order by 1`)
      ).rows.map((r) => r.line);

    it("AC11: running the migration's SQL again on a migrated database succeeds and leaves the same rights", async () => {
      const sql = await appRoleMigrationSql();
      const { before, after } = await rolledBack(async () => {
        const before = await grants();
        await db.query(sql);
        return { before, after: await grants() };
      });
      expect(before.some((line) => line.endsWith("to haul_app: SELECT")), "haul_app holds rights before the re-run").toBe(true);
      expect(after).toEqual(before);
    });
  });
});
