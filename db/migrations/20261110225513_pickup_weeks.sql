-- 20261110225513_pickup_weeks.sql — pickup_weeks
-- Applied in filename order by db/migrate.ts (DEC-013).

-- The weeks an admin changed (DEC-030, DEC-031). A week is named by its ordinary Sunday, `week_of`; a product's
-- weeks come from its weekly rule (src/pickup-week.ts), and a row here holds only a week that differs from it.
-- No row is an ordinary open week. `closed_at` set closes the week; `first_day` and `last_day` set move its days,
-- and null keeps them ordinary (the Sunday and the Monday after). The cutoff never moves.
create table pickup_weeks (
  product_id uuid not null references products (id),
  week_of date not null check (extract(isodow from week_of) = 7),
  closed_at timestamptz,
  note nonblank_text,
  first_day date,
  last_day date,
  primary key (product_id, week_of),
  check ((first_day is null) = (last_day is null)),
  check (last_day >= first_day)
);

-- A moved week's first day must come after the date of its cutoff. That date is the product's cutoff weekday on
-- or before `week_of`, which needs the product's row, so it is a trigger and not a column check.
-- Mirrors the rule in src/pickup-week.ts (`cutoffOf` inside `firstPickup`), which dates the cutoff
-- `addDays(sunday, cutoffWeekday - 7)`; the time of day does not matter, only the date.
create function pickup_weeks_check_first_day() returns trigger
language plpgsql as $$
declare
  cutoff_date date;
begin
  if new.first_day is null then
    return new;
  end if;
  select new.week_of + (p.cutoff_weekday - 7) into cutoff_date
    from products p
   where p.id = new.product_id;
  if new.first_day <= cutoff_date then
    raise exception 'pickup_weeks: first_day % is not after the week''s cutoff date %', new.first_day, cutoff_date
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger pickup_weeks_first_day_after_cutoff before insert or update on pickup_weeks
  for each row execute function pickup_weeks_check_first_day();

create trigger audit after insert or update or delete on pickup_weeks
  for each row execute function audit_row();
