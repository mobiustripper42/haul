-- 20261104045127_audit_detail_and_actor.sql — audit_detail_and_actor
-- Applied in filename order by db/migrate.ts (DEC-013).

-- An event row can carry what the trigger cannot tell: the duplicates an email match found, say
-- (DEC-028). It is a column of its own rather than `after`, so an event row never looks like a row
-- change. Null on every trigger row, and on every event row written so far.
alter table audit_log add column detail jsonb;

-- audit_event() gains a fourth argument, `detail`. Hardened as the three-argument one was
-- (20261102155411_audit_events.sql): security definer, a search_path of pg_catalog and pg_temp only,
-- every table name qualified with `public.`, EXECUTE revoked from public. The actor expression is unchanged: the app sets
-- it per transaction through withActor, and a write outside one records null.
create function audit_event(event text, table_name text, row_key jsonb, detail jsonb) returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.audit_log (table_name, operation, event, row_key, before, after, detail, actor, db_user)
  values (
    audit_event.table_name,
    'event',
    audit_event.event,
    audit_event.row_key,
    null,
    null,
    audit_event.detail,
    -- once set in a session, the setting reads back as '' in later transactions, never null
    nullif(current_setting('haul.actor', true), ''),
    session_user
  );
end;
$$;

revoke execute on function public.audit_event(text, text, jsonb, jsonb) from public;

-- The three-argument function goes, so there is one way in.
drop function public.audit_event(text, text, jsonb);
