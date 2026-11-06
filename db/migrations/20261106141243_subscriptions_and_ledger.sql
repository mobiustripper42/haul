-- 20261106141243_subscriptions_and_ledger.sql — subscriptions_and_ledger
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Task 1.4: a member's first subscription and the first ledger row. Square holds cards and charges;
-- Haul holds the person (docs/SPEC.md §7.3), so the only thing stored about a Square customer is its id.
-- Null until the member's first payment.
alter table members add column square_customer_id nonblank_text unique;

-- A member holds one or more subscriptions (DEC-026): nothing here limits a member to one once a row
-- is active. `pending` is a signup in progress, `active` one a paid first week confirmed. The consent
-- wording, amounts and time are what the member agreed to (docs/SPEC.md §7.12).
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members (id),
  product_id uuid not null references products (id),
  status text not null check (status in ('pending', 'active')),
  square_card_id nonblank_text,
  consent_text nonblank_text not null,
  consent_at timestamptz not null,
  first_charge_cents integer not null check (first_charge_cents >= 0),
  weekly_cents integer not null check (weekly_cents >= 0),
  created_at timestamptz not null default now()
);

-- One pending row per member and product, which is what makes a double submit or a second tab one
-- signup (task 1.4, AC11). It limits nothing after a row is active.
create unique index subscriptions_one_pending on subscriptions (member_id, product_id) where status = 'pending';

-- Every signup check asks for a member's rows for one product, whatever their status.
create index on subscriptions (member_id, product_id);

-- The pick, one option per option type (option types are data: DEC-006, DEC-027).
create table subscription_options (
  subscription_id uuid not null references subscriptions (id),
  option_type_id uuid not null references option_types (id),
  option_id uuid not null references options (id),
  primary key (subscription_id, option_type_id)
);

-- One charge a subscription: written pending before anything is charged, and its id is the idempotency
-- key's base (DEC-003). `pickup_date` is a local date (DEC-017). Later statuses arrive with the task that writes them.
create table ledger (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions (id),
  pickup_date date not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null check (status in ('pending', 'paid', 'declined')),
  attempt integer not null default 1 check (attempt >= 1),
  square_payment_id nonblank_text,
  paid_at timestamptz,
  unique (subscription_id, pickup_date)
);

create trigger audit after insert or update or delete on subscriptions
  for each row execute function audit_row();
create trigger audit after insert or update or delete on subscription_options
  for each row execute function audit_row();
create trigger audit after insert or update or delete on ledger
  for each row execute function audit_row();

-- Five events join the four (DEC-028). The names are also AUDIT_EVENT_KINDS in src/ports/repository.ts;
-- a test holds the two together.
alter table audit_log drop constraint audit_log_event_known_check;
alter table audit_log add constraint audit_log_event_known_check
  check (event in (
    'sign_in_by_code', 'sign_in_by_link', 'lock', 'rate_limit_refusal',
    'already_subscribed', 'square_customer_linked', 'square_customer_duplicates', 'card_declined', 'charge_outcome_unknown'
  ));
