---
schema: 1
id: DEC-042
title: "A subscription is locked at one decline"
topic: "Product rules"
status: "active"
date: "2026-11-16"
ruling: "A subscription holding a declined row for an earlier week is locked: the charge run writes it a locked row at 0 cents, no meal is made and nothing is charged, until a person pays the declined week or cancels."
claims:
  - kind: "file"
    target: "src/adapters/postgres-repository.ts"
    note: "the lock in dueAsOf; enrolWeek writes the row"
  - kind: "file"
    target: "src/charge-run.ts"
    note: "the locked count and email"
  - kind: "file"
    target: "db/migrations/20261116202537_ledger_locked.sql"
  - kind: "test"
    target: "src/adapters/charge-run-contract.ts"
revisit_if: "The farm wants a grace period before a lock, or a lock only after a second failed week"
---

## DEC-042: A subscription is locked at one decline

DEC-004 says a declined weekly charge does not stop the box: the farm makes it and follows up. Left alone, that is one
unpaid meal a week while the card stays declined. This narrows it to one box: the declined week's meal is still made, and
every week after it is locked.

A locked week gets a ledger row of its own status, `locked`, at 0 cents, written by `enrolWeek` as a week-credit week is
written `paid` at 0 (DEC-035). The row makes a second firing send no second email (the ledger is the queue) and keeps the
week off the kitchen's lists. Rejected: no row, with an audit event as the "already emailed" check (the audit log would
become a queue), and a `skipped` row (the member would see "Skipped" and an Unskip button on a week they did not skip).

The lock is decided before a week credit (DEC-032: a locked week spends none) and before the 0-cent rule. It counts only a
declined row for an earlier week. It ends only when a person acts: a card update paying the declined week, or the admin
cancelling. Locked rows stay, never charged. Only an `active` subscription is locked. See also DEC-004.
