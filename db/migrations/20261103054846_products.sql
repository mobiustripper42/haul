-- 20261103054846_products.sql — products
-- Applied in filename order by db/migrate.ts (DEC-013).

-- The Supper Club as data (DEC-006, DEC-007, DEC-027): a product, its option types, their options.
-- No rows here; the `supper-club` seed fills them in dev, and task 1.8 decides how production gets them.

-- The one home of the blank-name rule. Every name column is of this domain, and a later table's
-- name column uses it too. A blank name fails a check, SQLSTATE 23514, as a table check would.
create domain nonblank_text as text check (btrim(value) <> '');

-- Every week's cutoff is `cutoff_weekday` at `cutoff_time`, America/New_York (DEC-017).
-- `cutoff_weekday` is ISO, 1 Monday to 7 Sunday, as Postgres's `isodow`. `24:00` is the end of that
-- day: `date '2027-01-04' + time '24:00'` is 2027-01-05 00:00. A cutoff closes the first pickup window
-- to open after it; that is a rule for the code that computes weeks, not a column.
create table products (
  id uuid primary key default gen_random_uuid(),
  name nonblank_text not null unique,
  cap integer not null check (cap >= 1),
  first_pickup_date date not null,
  cutoff_weekday smallint not null check (cutoff_weekday between 1 and 7),
  cutoff_time time not null
);

-- No uniqueness on `position`: readers order by `position`, then `name`.
create table option_types (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  name nonblank_text not null,
  position smallint not null,
  unique (product_id, name)
);

create table options (
  id uuid primary key default gen_random_uuid(),
  option_type_id uuid not null references option_types (id),
  name nonblank_text not null,
  price_cents integer not null check (price_cents >= 0),
  position smallint not null,
  unique (option_type_id, name)
);

create trigger audit after insert or update or delete on products
  for each row execute function audit_row();
create trigger audit after insert or update or delete on option_types
  for each row execute function audit_row();
create trigger audit after insert or update or delete on options
  for each row execute function audit_row();
