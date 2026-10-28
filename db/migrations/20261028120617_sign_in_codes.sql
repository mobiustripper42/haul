-- 20261028120617_sign_in_codes.sql — sign_in_codes
-- Applied in filename order by db/migrate.ts (DEC-013).


-- One row per member: a new code replaces the old, so a member holds at most one live code.
-- failed_since and failed_in_window are the member's wrong-guess window, which outlives any one
-- code: a new code does not reset it.
create table sign_in_codes (
  member_id uuid primary key references members(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  failed_since timestamptz,
  failed_in_window integer not null default 0
);
