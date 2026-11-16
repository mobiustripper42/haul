-- 20261116202537_ledger_locked.sql — ledger_locked
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Task 2.13a (issue 196, DEC-042): a week the charge run enrols for a subscription holding a declined row for an earlier
-- week is written 'locked' at 0 cents, never charged, so the status check allows it. The row is the run's "already
-- emailed" check, as the ledger is its queue. The status check alone: no column, no table.
alter table ledger drop constraint ledger_status_check;
alter table ledger add constraint ledger_status_check check (status in ('pending', 'paid', 'declined', 'skipped', 'locked'));

