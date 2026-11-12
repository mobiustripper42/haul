---
schema: 1
id: DEC-033
title: "A week credit holds the picks in effect for the week it answers for"
topic: "Data model"
status: "active"
date: "2026-11-12"
ruling: "Picks are dated sets in subscription_options, and a week credit holds the set in effect for the week of the paid row it answers for, so a switch never changes what a week charged or a week credit is worth."
claims:
  - kind: "spec"
    target: "§7.2"
  - kind: "file"
    target: "db/migrations/20261112020828_dated_picks.sql"
  - kind: "file"
    target: "src/adapters/postgres-repository.ts"
  - kind: "test"
    target: "src/adapters/week-credit-contract.ts"
supersedes:
  - DEC-032
revisit_if: "A week credit must be worth a different meal than the one charged, or refunds become a weekly chore the farm wants built"
---

## DEC-033: A week credit holds the picks in effect for the week it answers for

DEC-032 had a week credit copy the subscription's picks at the grant. Task 2.6 lets a member switch, and a week
already charged must keep the picks it was charged for. `subscription_options` therefore holds
dated sets: `from_week`, the Sunday key (DEC-031) of the first week a set applies to. The picks for a week are the
set with the latest `from_week` on or before it, a whole set and never a per-type latest row. A week credit copies
the set in effect for the week of the ledger row it is granted for, so a switch cannot change it.

The rest of DEC-032 stands, restated whole: one week credit per subscription (§7.2); `week_credits.granted_for`
is the paid ledger row it answers for and is unique; reopening a week deletes the credits its closing granted;
`spent_on` is null until the charge run spends one. Refunds stay manual in Square (DEC-005, as
DEC-032 restated it). A skipped week does not use a week credit.

History reads the set in effect for each paid week; the account pages and the admin's list, the newest.
The charge run (2.2) should total the week's set, not read `weekly_cents`.
