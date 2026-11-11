-- 20261111023659_week_credits.sql — week_credits
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Task 2.1b (DEC-032): a week credit is one meal, of the picks that were charged, granted to a subscription when
-- a week it paid for closes (docs/SPEC.md §7.2). `granted_for` is the paid ledger row it answers for, so a week
-- credit finds its week through that row's Sunday key (DEC-031), and unique makes closing a week twice grant it
-- once. `spent_on` is the ledger row of the later week's charge that a week credit paid for; null until the
-- charge run spends one, and nothing writes it before then.
create table week_credits (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions (id),
  granted_for uuid not null unique references ledger (id),
  spent_on uuid unique references ledger (id),
  granted_at timestamptz not null
);

-- The size that was charged, as the subscription's full set of picks at the grant (option types are data:
-- DEC-027, so there is no size column). Copied from `subscription_options`, so a later switch cannot change what
-- a week credit is worth. Deleting a week credit deletes its picks.
create table week_credit_options (
  week_credit_id uuid not null references week_credits (id) on delete cascade,
  option_type_id uuid not null references option_types (id),
  option_id uuid not null references options (id),
  primary key (week_credit_id, option_type_id)
);

create trigger audit after insert or update or delete on week_credits
  for each row execute function audit_row();
create trigger audit after insert or update or delete on week_credit_options
  for each row execute function audit_row();
