---
schema: 1
id: DEC-045
title: "A locked subscription can neither skip nor switch"
topic: "Product rules"
status: "draft"
date: "2026-11-17"
ruling: "A locked subscription is offered no Skip, Unskip or Switch, and the server refuses them silently. Weeks after the declined week read Locked, the declined week reads Card declined, and the declined Notice tops Upcoming weeks."
claims:
  - kind: "file"
    target: "src/account-weeks.ts"
    note: "lockedWeek, the one home of the lock, and the rule that builds Upcoming weeks"
  - kind: "file"
    target: "src/switch-meal.ts"
    note: "switchWeek returns none while locked"
  - kind: "test"
    target: "src/account-weeks.test.ts"
revisit_if: "A member with a declined card should be able to skip a week, or the farm wants a refused request to say why"
---

## DEC-045: A locked subscription can neither skip nor switch

DEC-042 locks a subscription at one decline: no meal is made and nothing is charged for the weeks after the declined
one, until a person pays the declined week or cancels. The account pages kept offering Skip, Unskip and Switch through
that lock, on weeks that would make no meal either way.

While locked (`lockedWeek`, an active subscription holding a declined row), no listed week has a button and there is no
switch week. The lock is decided once, in the rule that builds Upcoming weeks and in `switchWeek`, so the page and its
three actions cannot disagree; Skip and Unskip need no code of their own, for they refuse any button the rebuilt rows do
not offer. A refused request goes back to Upcoming weeks with no Notice, as a stale form does: the page never offered it.

The weeks after the declined week show Locked, a week holding a `locked` ledger row stays Locked after the card update
(the row stays, DEC-042), and the declined week shows Card declined. An admin closing a week wins over all of these. See
also DEC-042.
