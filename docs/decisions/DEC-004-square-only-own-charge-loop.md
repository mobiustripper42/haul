---
schema: 1
id: DEC-004
title: "Square only, charged by Haul's own loop: first week at signup, then at cutoff"
topic: "Payments"
status: "active"
date: "2026-10-25"
ruling: "Every payment goes through Square on a card on file. The first week is charged at signup; later weeks by Haul's own run at cutoff. Square's Subscriptions API is not used."
claims:
  - kind: "spec"
    target: "§7.3"
  - kind: "file"
    target: "docs/sources/2026-10-market-scan.md"
    note: "Square Subscriptions billing and pause behaviour"
revisit_if: "Square Subscriptions gains cutoff-based charging with skip and switch, or the farm moves processors"
---

## DEC-004: Square only, charged by Haul's own loop

One processor keeps the farm's volume together toward Square's custom rates, and the farm already
runs Square at the POS. Per the market scan (Key Finding 5, citing Square's docs), Square
Subscriptions bills in advance from a billing anchor and pauses at the end of a period, which
fights "charge exactly at cutoff, change anything until then".

Charging at signup surfaces a bad card while the member is still on the page, instead of at the
first cutoff. A declined weekly charge does not stop the box: the farm makes it and follows up.
