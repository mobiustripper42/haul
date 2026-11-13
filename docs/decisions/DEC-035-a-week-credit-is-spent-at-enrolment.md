---
schema: 1
id: DEC-035
title: "A week credit is spent at enrolment, as a paid 0-cent row"
topic: "Payments"
status: "active"
date: "2026-11-13"
ruling: "A week credit is spent when the charge run enrols a week: the row is written paid at 0 cents with no Square payment, and a 0-cent set is written the same way, so neither is ever pending or charged."
claims:
  - kind: "file"
    target: "src/adapters/postgres-repository.ts"
    note: "enrolWeek writes the row and spends the credit in one statement"
  - kind: "file"
    target: "src/charge-run.ts"
    note: "the receipt for a week a credit paid"
revisit_if: "A week credit must be spent after enrolment, or a 0-cent week needs a Square payment of its own"
---

## DEC-035: A week credit is spent at enrolment, as a paid 0-cent row

The payments port refuses a zero amount, so a `pending` 0-cent row would never settle: it would record
`charge_outcome_unknown` on every firing. `enrolWeek` is the one place that already decides who is due and at what
amount, so it decides this too: a subscription holding an unspent week credit granted for an earlier week gets its row
`paid` at 0 cents, `paid_at` the week's cutoff, and its oldest credit's `spent_on` is that row. The spend rides on the
insert, so a second firing over the same state writes nothing and spends nothing. A credit comes first: the meal is the
credit's picks (DEC-033), whatever the subscription's current set sums to. A set that sums to 0 cents and holds no credit
is written the same way, spending nothing. Neither reaches the run's settle, so neither is charged; a week credit's
member gets a receipt saying it was used and not charged. Due is not about the card (DEC-034): a member with none spends
a credit like any other. Refunds stay by hand in Square (DEC-005). See also DEC-033, DEC-034.
