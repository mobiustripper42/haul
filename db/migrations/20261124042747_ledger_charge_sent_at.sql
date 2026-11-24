-- 20261124042747_ledger_charge_sent_at.sql — ledger_charge_sent_at
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Issue 254 (DEC-053): when a member's charge that has no recorded answer yet was sent, on a signup's pending row or a card
-- update's declined one (which stays declined). A charge is out while it is set; null once the row settles. `ledger` already
-- carries the audit trigger.
alter table ledger add column charge_sent_at timestamptz;
