-- 20261115022042_run_leases.sql — run_leases
-- Applied in filename order by db/migrate.ts (DEC-013).

-- One row per scheduled run that must fire one at a time (issue 174; DEC-038): the charge run claims its row
-- before it does anything and deletes it when it finishes. A row whose held_until has passed is free, which is how
-- a crashed firing's lease expires. The token says whose lease it is, so a firing releases only its own. The app
-- role's default privileges (DEC-037) give haul_app its four rights; the table is audit-exempt (db/schema-check.ts).
create table run_leases (
  name text primary key,
  token uuid not null,
  held_until timestamptz not null
);
