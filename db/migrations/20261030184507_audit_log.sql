-- 20261030184507_audit_log.sql — audit_log
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Every insert, update and delete on an audited table writes one row here, by trigger, so a SQL
-- edit is seen as well as the app's (DEC-007, DEC-019). The tables that carry no trigger are
-- listed, with reasons, in AUDIT_EXEMPT in db/schema-check.ts, which the gate enforces.
create table audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),          -- the transaction's time
  xact_id     bigint not null default pg_current_xact_id()::text::bigint,
  table_name  text not null,
  operation   text not null check (operation in ('insert', 'update', 'delete')),
  row_key     jsonb not null,
  before      jsonb,
  after       jsonb,
  actor       text,
  db_user     text not null
);

-- The trigger function. security definer, so the app's database user needs no insert right on
-- audit_log and cannot write a row of its own; session_user rather than current_user, because
-- inside a security definer function current_user is the function's owner.
--
-- The no-change test is in here rather than in a WHEN clause: a WHEN naming OLD cannot sit on a
-- trigger that also fires on insert. It returns null, which in an after-trigger changes nothing.
create function audit_row() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed jsonb;
  key jsonb;
begin
  if tg_op = 'UPDATE' and old is not distinct from new then
    return null;
  end if;

  changed := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  select coalesce(jsonb_object_agg(a.attname, changed -> a.attname), '{}'::jsonb)
    into key
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = tg_relid and i.indisprimary;

  insert into audit_log (table_name, operation, row_key, before, after, actor, db_user)
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

create trigger audit after insert or update or delete on members
  for each row execute function audit_row();
