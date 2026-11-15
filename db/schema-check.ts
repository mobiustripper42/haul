/**
 * The schema check (DEC-019, DEC-017). Reads the catalog of the connected database and reports
 * every table that would escape the audit trigger or store a time the wrong way. Only base tables
 * in the public schema are checked. It only reads: a caller may create scratch tables inside a
 * transaction it rolls back and call this on the same client.
 */
import { APP_ROLE } from "../src/adapters/pg-connect.js";
import type { Client } from "../src/adapters/pg-connect.js";

/** Table name → one-line reason it carries no audit trigger. */
export const AUDIT_EXEMPT: Readonly<Record<string, string>> = {
  audit_log: "the log itself: auditing it would write a row for every row written",
  _migrations: "the migration ledger, written by db/migrate.ts, not business data",
  rate_limit_hits:
    "counters keyed by client address: auditing them would keep addresses forever, past the sweep that deletes them",
  sign_in_codes:
    "holds unsalted SHA-256 hashes of 6-digit codes, which reverse in milliseconds: auditing them would keep them after expiry",
  email_changes:
    "holds an unsalted SHA-256 hash of a 6-digit code, which reverses in milliseconds, and is rewritten on every guess: auditing it would keep the hash after expiry",
};

/** The rights the app's role holds on every table not in APP_RIGHTS_EXCEPTIONS (issue 185). */
export const APP_TABLE_RIGHTS = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

/**
 * Table name → the app role's rights on it instead of APP_TABLE_RIGHTS, and why. Rights are upper
 * case, as `aclexplode` returns them. A separate list from AUDIT_EXEMPT: rate_limit_hits and
 * sign_in_codes are audit-exempt but the app needs all four on them (DEC-037).
 */
export type AppRightsExceptions = Readonly<Record<string, { rights: readonly string[]; reason: string }>>;

export const APP_RIGHTS_EXCEPTIONS: AppRightsExceptions = {
  audit_log: {
    rights: ["SELECT"],
    reason: "the app reads the log (its repository checks for an event row) and never rewrites it; the audit trigger and audit_event() write it",
  },
  _migrations: {
    rights: [],
    reason: "the migration ledger belongs to db/migrate.ts, which runs as the owner, not the app",
  },
};
export type SchemaViolation = {
  kind:
    | "missing-trigger"
    | "no-primary-key"
    | "stale-exemption"
    | "timestamp-without-time-zone"
    | "time-as-text"
    | "app-rights"
    | "stale-rights-exception"
    | "public-rights"
    | "public-execute"
    | "app-role-powers"
    | "missing-default-privileges";
  /** The table; for the kinds that name none, the object: the function (`public-execute`), the role (`app-role-powers`), the schema (`missing-default-privileges`). */
  table: string;
  column?: string; // set for the two time kinds only
  detail?: string; // set for app-role-powers only: the power
};

/**
 * A trigger counts when it calls audit_row, is row-level, fires after, on all three events, has no
 * WHEN condition and no UPDATE OF column list, and is enabled.
 */
const TABLES_WITH_COUNTING_TRIGGER = `
  select c.relname as table_name
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p')
     and exists (
       select 1
         from pg_trigger t
         join pg_proc p on p.oid = t.tgfoid and p.proname = 'audit_row' and p.pronamespace = 'public'::regnamespace
        where t.tgrelid = c.oid
          and not t.tgisinternal
          and t.tgenabled in ('O', 'A')
          and t.tgtype & 1 = 1    -- row-level
          and t.tgtype & 2 = 0    -- not before
          and t.tgtype & 64 = 0   -- not instead of
          and t.tgtype & 28 = 28  -- insert, delete and update
          and t.tgqual is null    -- no WHEN condition
          and t.tgattr::text = '' -- no UPDATE OF column list
     )`;

export async function schemaViolations(
  db: Client,
  exempt: Readonly<Record<string, string>> = AUDIT_EXEMPT,
  appRights: AppRightsExceptions = APP_RIGHTS_EXCEPTIONS,
): Promise<SchemaViolation[]> {
  const violations: SchemaViolation[] = [];

  const tables = (
    await db.query<{ table_name: string; has_pk: boolean }>(
      `select c.relname as table_name,
              exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary) as has_pk
         from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`,
    )
  ).rows;
  const audited = new Set((await db.query<{ table_name: string }>(TABLES_WITH_COUNTING_TRIGGER)).rows.map((r) => r.table_name));

  for (const { table_name: table, has_pk } of tables) {
    if (Object.hasOwn(exempt, table)) continue;
    if (!audited.has(table)) violations.push({ kind: "missing-trigger", table });
    if (!has_pk) violations.push({ kind: "no-primary-key", table });
  }

  const existing = new Set(tables.map((t) => t.table_name));
  for (const table of Object.keys(exempt)) {
    if (!existing.has(table)) violations.push({ kind: "stale-exemption", table });
  }

  // Time columns, in every table, exempt ones included (DEC-017).
  const columns = (
    await db.query<{ table_name: string; column_name: string; naive: boolean }>(
      `select c.relname as table_name, a.attname as column_name, a.atttypid = 'timestamp'::regtype as naive
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
        where c.relnamespace = 'public'::regnamespace
          and c.relkind in ('r', 'p')
          and a.attnum > 0
          and not a.attisdropped
          and (a.atttypid = 'timestamp'::regtype
               or (a.atttypid in ('text'::regtype, 'varchar'::regtype) and a.attname ~ '(_at|_since|_until|_date|_time)$'))`,
    )
  ).rows;
  for (const { table_name: table, column_name: column, naive } of columns) {
    violations.push({
      kind: naive ? "timestamp-without-time-zone" : "time-as-text",
      table,
      column,
    });
  }

  violations.push(...(await appRoleViolations(db, existing, appRights)));

  return violations;
}

/** The app role's rights, and what PUBLIC and the role itself hold (DEC-037). Reads the catalog only. */
async function appRoleViolations(
  db: Client,
  existing: ReadonlySet<string>,
  appRights: AppRightsExceptions,
): Promise<SchemaViolation[]> {
  const violations: SchemaViolation[] = [];

  // The app role's rights on each table, exactly: aclexplode names every right, TRUNCATE, REFERENCES,
  // TRIGGER and MAINTAIN included, so an extra one differs from the expected set.
  const held = (
    await db.query<{ table_name: string; rights: string[] }>(
      `select c.relname as table_name,
              coalesce(array_agg(distinct a.privilege_type::text order by a.privilege_type::text) filter (where a.privilege_type is not null), '{}') as rights
         from pg_class c
         left join lateral aclexplode(c.relacl) a on a.grantee = (select oid from pg_roles where rolname = $1)
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
        group by c.relname`,
      [APP_ROLE],
    )
  ).rows;
  for (const { table_name: table, rights } of held) {
    const expected = Object.hasOwn(appRights, table) ? (appRights[table]?.rights ?? []) : APP_TABLE_RIGHTS;
    if (JSON.stringify([...expected].sort()) !== JSON.stringify(rights)) violations.push({ kind: "app-rights", table });
  }
  for (const table of Object.keys(appRights)) {
    if (!existing.has(table)) violations.push({ kind: "stale-rights-exception", table });
  }

  // PUBLIC holds nothing on a table, and cannot execute either audit function. A function with no
  // ACL at all carries Postgres's default, which includes PUBLIC's EXECUTE.
  const publicTables = await db.query<{ table_name: string }>(
    `select distinct c.relname as table_name
       from pg_class c, aclexplode(c.relacl) a
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and a.grantee = 0`,
  );
  for (const { table_name: table } of publicTables.rows) violations.push({ kind: "public-rights", table });

  const publicFunctions = await db.query<{ proname: string }>(
    `select distinct p.proname
       from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('audit_row', 'audit_event')
        and a.grantee = 0 and a.privilege_type = 'EXECUTE'`,
  );
  for (const { proname } of publicFunctions.rows) violations.push({ kind: "public-execute", table: proname });

  // The role holds no power beyond its grants: no superuser, createrole or bypassrls, no membership
  // of another role, and no object of its own (ownership is read from pg_shdepend, so it covers
  // tables, functions, types and schemas alike).
  const powers = (
    await db.query<{ detail: string }>(
      `select power as detail from pg_roles r,
         lateral (values (case when r.rolsuper then 'superuser' end),
                         (case when r.rolcreaterole then 'createrole' end),
                         (case when r.rolbypassrls then 'bypassrls' end)) v(power)
        where r.rolname = $1 and power is not null
       union all
       select 'member of ' || g.rolname
         from pg_auth_members m
         join pg_roles r on r.oid = m.member and r.rolname = $1
         join pg_roles g on g.oid = m.roleid
       union all
       select 'owns ' || pg_describe_object(d.classid, d.objid, d.objsubid)
         from pg_shdepend d
         join pg_roles r on r.oid = d.refobjid and r.rolname = $1
        where d.refclassid = 'pg_authid'::regclass
          and d.deptype = 'o'
          and d.dbid = (select oid from pg_database where datname = current_database())`,
      [APP_ROLE],
    )
  ).rows;
  for (const { detail } of powers) violations.push({ kind: "app-role-powers", table: APP_ROLE, detail });

  // Future tables get the four: some default-privileges entry for public's tables grants the role all of them.
  const defaults = await db.query<{ ok: boolean }>(
    `select exists (
       select 1
         from pg_default_acl d
        where d.defaclnamespace = 'public'::regnamespace
          and d.defaclobjtype = 'r'
          and (select count(distinct a.privilege_type)
                 from aclexplode(d.defaclacl) a
                where a.grantee = (select oid from pg_roles where rolname = $1)
                  and a.privilege_type = any ($2)) = $3
     ) as ok`,
    [APP_ROLE, [...APP_TABLE_RIGHTS], APP_TABLE_RIGHTS.length],
  );
  if (!defaults.rows[0]?.ok) violations.push({ kind: "missing-default-privileges", table: "public" });

  return violations;
}
