-- 20261112195423_email_changes.sql — email_changes
-- Applied in filename order by db/migrate.ts (DEC-013).

-- One row per member: a pending change of the sign-in email, waiting for the code sent to the new
-- address. A new change replaces the row. It has its own table because sign_in_codes holds one code
-- per member, so a sign-in partway through a change would wipe the confirmation code.
create table email_changes (
  member_id uuid primary key references members(id) on delete cascade,
  new_email text not null,
  code_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  attempts integer not null default 0
);
