---
schema: 1
id: DEC-005
title: "Refunds and store credit are manual; a late closure earns a week credit"
topic: "Payments"
status: "active"
date: "2026-10-25"
ruling: "Haul builds no refund or store-credit flow; the farm refunds in Square's dashboard. A week closed after its cutoff earns a week credit — the next week taken is made and not charged — not a refund."
claims:
  - kind: "spec"
    target: "§7.2"
  - kind: "spec"
    target: "§7.3"
revisit_if: "Manual refunds become a weekly chore, skip-to-credit leaves future ideas, or members want a credit worth a different box than they paid for"
---

## DEC-005: Refunds and store credit are manual; a late closure earns a week credit

Eric's experience in muster (2026-10-25) is that refunds and credit multiply the complexity of a
payment system. Lenny's answer was that refund requests come to him directly, which fits. The charge
run's job is to not charge what should not be charged — closed and skipped weeks before cutoff — so
a refund is the exception. Both stay in future ideas.

Changed 2026-10-26, before any code: a week closed after its cutoff (the kitchen flooded) no longer
means refunding everyone. Each member charged for it gets a week credit instead. A week credit is
not store credit: it is one box, whatever that week's price or the member's size — a box is a box,
for V1. A skipped week doesn't use it; a member who cancels with one unused is refunded by hand. A
farm that closes for good refunds in Square, and no code is written for it.
