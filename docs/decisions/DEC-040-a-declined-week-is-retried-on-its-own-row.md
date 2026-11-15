---
schema: 1
id: DEC-040
title: "A declined week is retried on its own row; a new card takes over once it pays"
topic: "Payments"
status: "active"
date: "2026-11-15"
ruling: "Saving a new card retries each open declined week as a new attempt on its own ledger row, oldest first, stopping at the first decline; the card replaces the old one only once it has paid a retried week, or at once when nothing is owed."
claims:
  - kind: "file"
    target: "src/update-card.ts"
    note: "updateCard: the bump, the order, the stop, and when the card is replaced"
  - kind: "test"
    target: "src/update-card.test.ts"
revisit_if: "A member asks to keep a card that failed its first retry, or Square adds a stored-card verification Haul can use before charging"
---

## DEC-040: A declined week is retried on its own row; a new card takes over once it pays

A member whose card was declined replaces it on `/account/card` (issue 145), and the weeks they owe are charged then, by
Haul, not by Square's subscriptions (DEC-004).

Each retry bumps the row's `attempt` before the charge, so the key `ledgerId:attempt` is fresh every time (DEC-003). The
row stays `declined` while the charge is out, which keeps it out of the charge run's queue of `pending` rows, and a paid
answer flips it through the charge run's own confirm. The bump is kept after a decline, so the next save's key is fresh too.

A card that declines one week is not tried on the next: rows already paid stay paid, the rest stay `declined`, and the
account home keeps its Notice. A charge with no answer stops the retry the same way and records `charge_outcome_unknown`.

The old card stays on file until the new one has paid something, so a member is never left holding a card that has never
worked. See also DEC-028, DEC-041.
