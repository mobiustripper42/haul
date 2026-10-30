-- 20261030043016_member_role.sql — member_role
-- Applied in filename order by db/migrate.ts (DEC-013).

-- What a member may do: one role each, in one checked column (DEC-018). The check refuses any value
-- the code would mistake for a role; adding a role later is a one-line migration that widens it.
alter table members
  add column role text not null default 'member' check (role in ('member', 'admin'));
