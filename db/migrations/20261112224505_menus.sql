-- 20261112224505_menus.sql — menus
-- Applied in filename order by db/migrate.ts (DEC-013).

-- The menu library (issue 140). A menu is a name; its texts are one row per option of the option type marked
-- `menu_texts`, so a new menu option is an insert into `options` and not a migration. A week holds a reference to
-- a menu in `week_menus`, not a column on `pickup_weeks`, which holds only weeks that differ from the rule: no
-- menu is no row.

-- Marks the option type whose options each get a menu text: at most one per product.
alter table option_types add column menu_texts boolean not null default false;
create unique index option_types_one_menu_texts on option_types (product_id) where menu_texts;

create table menus (
  id uuid primary key default gen_random_uuid(),
  name nonblank_text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table menu_texts (
  menu_id uuid not null references menus (id),
  option_id uuid not null references options (id),
  text nonblank_text not null,
  primary key (menu_id, option_id)
);

create table week_menus (
  product_id uuid not null references products (id),
  week_of date not null check (extract(isodow from week_of) = 7),
  menu_id uuid not null references menus (id),
  primary key (product_id, week_of)
);

create trigger audit after insert or update or delete on menus
  for each row execute function audit_row();
create trigger audit after insert or update or delete on menu_texts
  for each row execute function audit_row();
create trigger audit after insert or update or delete on week_menus
  for each row execute function audit_row();
