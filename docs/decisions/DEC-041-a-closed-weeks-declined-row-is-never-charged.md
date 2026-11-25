---
schema: 1
id: DEC-041
title: "A closed week's declined row is never charged, and a card save deletes it"
topic: "Payments"
status: "active"
date: "2026-11-15"
ruling: "A declined row whose week an admin closed is never retried; it still shows the member's declined Notice and badge, and a save that puts a new card on file deletes it."
claims:
  - kind: "file"
    target: "src/update-card.ts"
    note: "updateCard: a closed week's row is never charged; a card on file deletes it"
  - kind: "test"
    target: "src/update-card.test.ts"
revisit_if: "A closed week can be reopened after its cutoff, or the farm wants a closed week's decline charged after all"
---

## DEC-041: A closed week's declined row is never charged, and a card save deletes it

Closing a week tells its members they "won't be charged" (`docs/SPEC.md` §7.2), and that includes a member whose row for
the week is `declined`. Retrying that row would charge for a week with no meal and then grant a week credit for it.

The row still counts as declined for the account home's Notice and badge: the member's card did decline. Nothing else
would ever clear it, so a save that puts a new card on file deletes it, as the charge run deletes a closed week's unpaid
row. A failed save deletes nothing. The delete cannot be wrong later: a declined row exists only after its week's cutoff,
and a closed week cannot reopen past its cutoff. See also DEC-053.
