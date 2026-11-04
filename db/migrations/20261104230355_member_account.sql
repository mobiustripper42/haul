-- 20261104230355_member_account.sql — member_account
-- Applied in filename order by db/migrate.ts (DEC-013).

-- An account is a member row whose email a sign-in code confirms (DEC-029). Create Account writes the
-- row with `email_confirmed_at` null; the first code or link redeemed sets it. The name and phone are
-- null for a member who never went through Create Account.
alter table members
  add column first_name nonblank_text,
  add column last_name nonblank_text,
  add column phone nonblank_text,
  add column email_confirmed_at timestamptz;

-- Members from before this migration signed in by a code, so their email is confirmed.
update members set email_confirmed_at = created_at;
