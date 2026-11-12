-- 20261112020828_dated_picks.sql — dated_picks
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Task 2.6 (issue 138): a member's picks are dated sets. `from_week` is the Sunday key (DEC-031) of the first week
-- a set applies to; the picks for a week are the set with the latest `from_week` on or before it, a whole set and
-- never a per-type latest row. A switch writes a new set at its switch week (DEC-033).
alter table subscription_options add column from_week date;

-- Every existing set is the one the subscription signed up with, so it applies from the subscription's earliest
-- ledger week and every paid week reads it. A subscription always has a ledger row from its signup, so none is
-- left null: the `not null` below would refuse a set with none rather than date it by a guess.
update subscription_options so
   set from_week = (select min(l.pickup_date) from ledger l where l.subscription_id = so.subscription_id);

alter table subscription_options alter column from_week set not null;

-- One option per option type in a set, and one set per start week. The audit trigger it already has stays (DEC-019).
alter table subscription_options drop constraint subscription_options_pkey;
alter table subscription_options add primary key (subscription_id, option_type_id, from_week);
