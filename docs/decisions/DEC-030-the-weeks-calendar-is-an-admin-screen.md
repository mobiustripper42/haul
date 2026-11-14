---
schema: 1
id: DEC-030
title: "The pickup-weeks calendar is an admin screen, not SQL"
topic: "Product rules"
status: "active"
date: "2026-11-10"
ruling: "An admin closes and moves pickup weeks from an admin calendar, because the farm must act on a week without the developer; the weekly rule stays code, and a table holds only the weeks an admin changed."
claims:
  - kind: "spec"
    target: "§7.2"
  - kind: "file"
    target: "db/migrations/20261110225513_pickup_weeks.sql"
  - kind: "file"
    target: "src/pickup-week.ts"
  - kind: "test"
    target: "db/pickup-weeks.test.ts"
revisit_if: "The farm closes or moves fewer than a few weeks a year, or a week needs more than a close, a move and a note"
---

## DEC-030: The pickup-weeks calendar is an admin screen, not SQL

Eric, 2026-11-10: Lenny closes and moves weeks himself (`docs/SPEC.md` §7.2). DEC-007 names "the
calendar" among the things set with SQL and seeds, and also says an admin screen exists where waiting
for the developer would fail the farm. A flooded kitchen is that case, so for weeks the calendar is a
screen. DEC-007 stands for everything else it lists: products, prices and the cutoff stay SQL.

Weeks are not rows to be generated ahead. A product's weeks come from its weekly rule in
`src/pickup-week.ts`, and `pickup_weeks` holds only a week that differs from the rule: closed, moved,
or carrying a note. No row is an ordinary open week. A week closed after its cutoff does not change
signup: the cutoff never moves.

The screen is task 2.1b; the table and signup's use of it are task 2.1a. See also DEC-007.
