-- 20261115001527_app_role.sql — app_role
-- Applied in filename order by db/migrate.ts (DEC-013).

-- The app's own database role, haul_app (DEC-037): it reads and writes the business tables, only reads
-- audit_log, has nothing on _migrations, and cannot truncate or change schema. Re-runnable by hand with
-- psql, and safe to run from two migrations at once on one server: roles are cluster-wide, so the
-- second create loses the race and is a no-op.
--
-- Production creates haul_app by hand first, with a login and a password, and then migrates; this
-- file never touches an existing role's login or password. Where it has to create the role itself
-- (local, CI) the role is NOLOGIN: a test or a dev connection reaches it with `set role`.
do $$
begin
  create role haul_app nologin;
exception
  when duplicate_object or unique_violation then null;
end;
$$;

-- Older Postgres (Azure) lets every role create in public; the app must not.
revoke create on schema public from public;
grant usage on schema public to haul_app;

-- Exactly the four on every table, then the two exceptions (APP_RIGHTS_EXCEPTIONS in
-- db/schema-check.ts). Revoking first makes a re-run leave the same rights whatever was granted since.
revoke all on all tables in schema public from haul_app;
grant select, insert, update, delete on all tables in schema public to haul_app;
revoke all on public.audit_log from haul_app;
grant select on public.audit_log to haul_app;
revoke all on public._migrations from haul_app;

-- audit_event() is the one way the app writes an event row (DEC-025); audit_row() stays unreachable.
grant execute on function public.audit_event(text, text, jsonb, jsonb) to haul_app;

-- Tables and sequences a later migration makes. Without `for role`, these bind to the user running
-- this migration, so every migration must run as that same user. A sequence behind a serial column
-- needs only USAGE for nextval.
alter default privileges in schema public grant select, insert, update, delete on tables to haul_app;
alter default privileges in schema public grant usage on sequences to haul_app;
