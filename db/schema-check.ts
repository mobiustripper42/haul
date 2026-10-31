/**
 * The schema check (DEC-019, DEC-017). Reads the catalog of the connected database and reports
 * every table that would escape the audit trigger or store a time the wrong way. Only base tables
 * in the public schema are checked. It only reads: a caller may create scratch tables inside a
 * transaction it rolls back and call this on the same client.
 */
import type { Client } from "../src/adapters/pg-connect.js";

/** Table name → one-line reason it carries no audit trigger. */
export const AUDIT_EXEMPT: Readonly<Record<string, string>> = {
  audit_log: "the log itself: auditing it would write a row for every row written",
  _migrations: "the migration ledger, written by db/migrate.ts, not business data",
  rate_limit_hits:
    "counters keyed by client address: auditing them would keep addresses forever, past the sweep that deletes them",
  sign_in_codes:
    "holds unsalted SHA-256 hashes of 6-digit codes, which reverse in milliseconds: auditing them would keep them after expiry",
};

export type SchemaViolation = {
  kind: "missing-trigger" | "no-primary-key" | "stale-exemption" | "timestamp-without-time-zone" | "time-as-text";
  table: string;
  column?: string; // set for the two time kinds only
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

  return violations;
}
