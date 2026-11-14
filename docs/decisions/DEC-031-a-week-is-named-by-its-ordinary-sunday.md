---
schema: 1
id: DEC-031
title: "A pickup week is named by its ordinary Sunday, moved or not"
topic: "Data model"
status: "active"
date: "2026-11-10"
ruling: "A pickup week is keyed by its ordinary Sunday; ledger.pickup_date holds that key even when the week's days are moved, and only the words on screen and in the email show the moved days."
claims:
  - kind: "spec"
    target: "§7.2"
  - kind: "file"
    target: "db/migrations/20261110225513_pickup_weeks.sql"
  - kind: "file"
    target: "src/pickup-week.ts"
  - kind: "test"
    target: "src/pickup-week.test.ts"
revisit_if: "A moved week must hold a different charge or credit than its ordinary Sunday would, or two weeks need the same Sunday"
---

## DEC-031: A pickup week is named by its ordinary Sunday, moved or not

A week has one name: its ordinary Sunday. `pickup_weeks.week_of` is that Sunday (a check refuses any
other day), and `ledger.pickup_date` stores the same key. Moving a week to Saturday and Sunday changes
`first_day` and `last_day` on the `pickup_weeks` row and nothing in the ledger, so a charge, a skip
or a week credit finds its week by the same date before and after a move.

The days are looked up again when a confirmation is read, so the done box and the email show the
week as it stands now, even when it was moved after signup. `pickupWeek` in `src/pickup-week.ts` is
the one place an ordinary week becomes its Sunday and Monday.

The cutoff is the ordinary Sunday's, so a moved week's first day must fall after the date of that
cutoff, which a trigger on `pickup_weeks` enforces.
