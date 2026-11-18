-- 20261118171748_subscriptions_comped.sql — subscriptions_comped
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Issue 194: a comped subscription is real and never charged; enrolWeek writes each of its weeks paid at 0 cents.
-- Set by `npm run db:comp` (DEC-007: no screen). The audit trigger the table already has covers it (DEC-019).
alter table subscriptions add column comped boolean not null default false;
