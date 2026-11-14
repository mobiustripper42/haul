-- 20261111212529_ledger_skipped.sql — ledger_skipped
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Task 2.5 (issue 137): a member's skip of an upcoming week is a ledger row with status 'skipped' and 0 cents
-- (docs/SPEC.md: the ledger is the source of all history), so the status check allows it. An unskip deletes the
-- row. The charge run (2.2b) treats a skipped row as settled and never charges it.
alter table ledger drop constraint ledger_status_check;
alter table ledger add constraint ledger_status_check check (status in ('pending', 'paid', 'declined', 'skipped'));
