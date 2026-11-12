---
schema: 1
id: DEC-032
title: "A week credit is a meal of the picks that were charged"
topic: "Data model"
status: "superseded"
date: "2026-11-10"
ruling: "Closing a week grants each subscription charged for it one week credit holding that subscription's picks at the grant, in week_credits and week_credit_options; a later switch cannot change what it is worth."
claims:
  - kind: "spec"
    target: "§7.2"
  - kind: "file"
    target: "db/migrations/20261111023659_week_credits.sql"
  - kind: "file"
    target: "src/adapters/postgres-repository.ts"
  - kind: "test"
    target: "src/adapters/week-credit-contract.ts"
superseded_by: DEC-033
revisit_if: "A week credit must be worth a different meal than the one charged, or refunds become a weekly chore the farm wants built"
---

## DEC-032: A week credit is a meal of the picks that were charged

DEC-005 said a week credit is "a box is a box", whatever the member's size. Option types are data
(DEC-027), so there is no size column to hold what was charged. A week credit instead copies the
subscription's full set of picks from `subscription_options` into `week_credit_options` at the grant,
so a later switch (task 2.6) cannot change what it is worth. Its next meal is made as those picks and
not charged.

One week credit per subscription, not per member: §7.2 says "every subscription", which settles what
DEC-026 deferred. `week_credits.granted_for` is the paid ledger row it answers for and is unique, so a
week closed twice grants once, and a week finds its credits through that row's Sunday key (DEC-031).
Reopening a week before its cutoff deletes the credits its closing granted. `spent_on`, null until the
charge run spends one, is part of the table now and nothing writes it yet.

Refunds stay manual in Square: that part of DEC-005 stands, restated here.

DEC-005 is superseded. A week credit is still not store credit, and a skipped week does not use one.
