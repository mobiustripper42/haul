---
schema: 1
id: DEC-026
title: "A member holds one or more subscriptions, to any product"
topic: "Data model"
status: "draft"
date: "2026-11-02"
ruling: "A member may hold one or more subscriptions, to any product; no rule limits a member to one. Phase 1's signup creates exactly one, and adding another comes later. A cap counts subscriptions, not members."
claims:
  - kind: "spec"
    target: "§7.3"
  - kind: "spec"
    target: "§9"
revisit_if: "The farm limits a member to one subscription per product, or a household asks to share one subscription between two members"
amends_spec:
  - section: "3"
    scope: "open question 13 leaves the critical path"
  - section: "7.3"
    scope: "a member may hold several subscriptions; the ledger stays keyed on subscription and week"
  - section: "9"
    scope: "open question 13 answered: one or more subscriptions per member, one created at Phase 1 signup"
---

## DEC-026: A member holds one or more subscriptions, to any product

Eric's call on spec open question 13 (2026-11-02): plan for many, because one is a special case of
many and the reverse is a schema change. The ledger is already keyed on subscription and week
(§7.3), so it does not move, and one per member stays a limit the farm could set later.

One rule is written per member and is not settled here: §7.2's week credit ("every member charged
for that week gets a week credit"). Whether a member with two boxes gets a credit per subscription
is decided in task 2.1's spec, which builds the credit. Until a member can add a second
subscription, the two readings agree.

Phase 1's signup creates exactly one subscription; a member adding another is in
`docs/FUTURE_IDEAS.md`. A cap spot is one subscription (§6.1, "~50 active subscriptions"), so a
household with two boxes takes two spots. What signup does with an email that already holds a
subscription is decided in task 1.3's spec (issue 55).
