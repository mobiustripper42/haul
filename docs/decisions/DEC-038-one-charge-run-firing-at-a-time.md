---
schema: 1
id: DEC-038
title: "One charge-run firing at a time, by a lease in the database"
topic: "Stack & hosting"
status: "active"
date: "2026-11-14"
ruling: "A charge-run firing claims a 30-minute lease row before it does anything and releases it when it finishes; a firing that finds the lease held does nothing and reports skipped: true, and the route still answers 200."
claims:
  - kind: "file"
    target: "src/charge-run.ts"
    note: "runCharges: the claim, the skipped report and the release in finally"
  - kind: "file"
    target: "db/migrations/20261115022042_run_leases.sql"
  - kind: "test"
    target: "src/adapters/run-lease-contract.ts"
revisit_if: "A firing legitimately runs past 30 minutes, the menu run needs the same guard, or a second host makes the database the wrong place to hold the lease"
---

## DEC-038: One charge-run firing at a time, by a lease in the database

DEC-003 lets firings overlap, and the run holds no transaction across a Square call, so one firing could delete a closed
week's row while another's charge on it was in flight: the payment confirmed against no row and was never recorded. The fix
stops the overlap rather than making it safe.

The lease is a `run_leases` row keyed by the run's name, with a token and a `held_until`. Claiming is one statement: insert,
or take over only a lease that expired at or before the claim's time, and get a fresh token or nothing, so two simultaneous
claims give one winner. Releasing deletes the row only when the token matches, so a late firing cannot release the next
holder's lease. A crashed firing's row expires on its own. Claim and release are each their own commit, outside
`withActor`, timed by the firing's `clock`. The table is audit-exempt: it changes every firing and holds no business data.

A skipped firing returns the ordinary report, every count 0 and `skipped: true`, and the route answers 200: a non-2xx could
make a scheduler retry a firing that has nothing to do. See also DEC-003.
