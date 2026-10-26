-- 20261026160728_members.sql — members
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Email is stored already normalized (trimmed, lowercased), so a plain unique constraint
-- enforces case-insensitive uniqueness. Each later task adds its own columns by migration.
create table members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);
