-- 20261030192012_audit_row_hardening.sql — audit_row_hardening
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Hardens audit_row() from the review of 20261030184507_audit_log.sql, which is applied and so is
-- not edited (DEC-013). Three changes, all to a security definer function:
--   * search_path lists pg_catalog and pg_temp only, and every other name is schema-qualified:
--     with pg_temp unlisted Postgres searches it first for tables, so a session's temporary
--     audit_log would take the audit rows.
--   * the no-change test compares to_jsonb(old) with to_jsonb(new): "old is not distinct from new"
--     needs an equality operator, which json, xml and point columns lack.
--   * PUBLIC loses EXECUTE: without that, any role could attach the function to a table of its own
--     and write audit rows of its choosing.
-- A trigger already attached keeps firing: EXECUTE is checked when a trigger is created, not when
-- it fires.
create or replace function audit_row() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  changed jsonb;
  key jsonb;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return null;
  end if;

  changed := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  select coalesce(jsonb_object_agg(a.attname, changed -> a.attname), '{}'::jsonb)
    into key
    from pg_catalog.pg_index i
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = tg_relid and i.indisprimary;

  insert into public.audit_log (table_name, operation, row_key, before, after, actor, db_user)
  values (
    tg_table_name,
    lower(tg_op),
    key,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    -- once set in a session, the setting reads back as '' in later transactions, never null
    nullif(current_setting('haul.actor', true), ''),
    session_user
  );
  return null;
end;
$$;

revoke execute on function public.audit_row() from public;
