-- 20261102155411_audit_events.sql — audit_events
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Beside the trigger's row changes, audit_log records the few things that happen once in a member's
-- sign-in: a sign-in by code, a sign-in by link, the lock, and an address's first rate-limit refusal
-- in a window (DEC-025). An event row has operation 'event', its name in `event`, and no before or
-- after. The rows go in through audit_event() below and nowhere else, so the app's database user
-- needs no insert right on audit_log (DEC-019).
alter table audit_log add column event text;

-- The operation check was written inline on the column, so Postgres named it.
alter table audit_log drop constraint audit_log_operation_check;
alter table audit_log add constraint audit_log_operation_check
  check (operation in ('insert', 'update', 'delete', 'event'));

-- An event row has a name and a row change does not.
alter table audit_log add constraint audit_log_event_named_check
  check ((operation = 'event') = (event is not null));

-- The names are also AUDIT_EVENT_KINDS in src/ports/repository.ts; a test holds the two together.
alter table audit_log add constraint audit_log_event_known_check
  check (event in ('sign_in_by_code', 'sign_in_by_link', 'lock', 'rate_limit_refusal'));

-- Writes one event row and nothing else. Hardened as audit_row() is (20261030192012_audit_row_hardening.sql):
-- security definer, a search_path of pg_catalog and pg_temp only, public. on every name, and EXECUTE
-- revoked from public. The actor and db_user expressions repeat audit_row()'s on purpose; a test
-- catches a copy that drifts.
create function audit_event(event text, table_name text, row_key jsonb) returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.audit_log (table_name, operation, event, row_key, before, after, actor, db_user)
  values (
    audit_event.table_name,
    'event',
    audit_event.event,
    audit_event.row_key,
    null,
    null,
    -- once set in a session, the setting reads back as '' in later transactions, never null
    nullif(current_setting('haul.actor', true), ''),
    session_user
  );
end;
$$;

revoke execute on function public.audit_event(text, text, jsonb) from public;
