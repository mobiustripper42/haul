---
schema: 1
id: DEC-040
title: "A declined week's charge after a card update is claimed on its own row"
topic: "Payments"
status: "active"
date: "2026-11-15"
ruling: "A card update claims the declined week on its own row in one write: card on file, row pending, attempt bumped, only while still declined. The key stays fixed until the charge settles; a save while any row is pending charges nothing."
claims:
  - kind: "file"
    target: "src/update-card.ts"
    note: "updateCard and retryCardCharge: the claim's answer, then the one settle step"
  - kind: "test"
    target: "src/update-card.test.ts"
revisit_if: "Square adds a stored-card verification Haul can use before charging, or a member asks to keep a card that failed"
---

## DEC-040: A declined week's charge after a card update is claimed on its own row

A member whose card was declined replaces it on `/account/card` (issue 145), and the declined week is charged then, by
Haul, not by Square's subscriptions (DEC-004). The lock (issue 196) leaves at most one declined week.

One write, `claimCardUpdate`, decides the save under the member row's lock: it puts the new card on file and turns the
open declined row `pending` with its `attempt` bumped, only while it is still `declined`. The key `ledgerId:attempt` is
fresh (DEC-003) and stays fixed until the charge settles, by the member's Try again (which asks Square first) or the
charge run's next firing (which charges the card now on file).

A save while any row is `pending` (two tabs, a reload, a charge-run row whose answer was lost) is refused: nothing is
charged and the second card is not put on file. A decline goes back through the signup's decline write and keeps the new
card; a charge with no answer leaves the row `pending` and records `charge_outcome_unknown`. The old card is not disabled
at Square. See also DEC-028, DEC-041.
