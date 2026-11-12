-- 20261112042025_cancelled_subscriptions.sql — cancelled_subscriptions
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Task 2.7 (issue 139): a member or an admin cancels a subscription. A cancel is a status plus the time it happened;
-- the ledger is not touched, so a week already charged stays a `paid` row (DEC-005). `cancelled_at` is set exactly when
-- the status is `cancelled`. The audit trigger `subscriptions` already has records the change (DEC-019).
alter table subscriptions add column cancelled_at timestamptz;

alter table subscriptions drop constraint subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check check (status in ('pending', 'active', 'cancelled'));

alter table subscriptions add constraint subscriptions_cancelled_at_check check ((status = 'cancelled') = (cancelled_at is not null));
