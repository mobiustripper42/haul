---
schema: 1
id: DEC-010
title: "Outside services sit behind ports with fakes; real adapters are chosen late"
topic: "Stack & hosting"
status: "active"
date: "2026-10-25"
ruling: "Payments, email, storage, translation and geocoding each sit behind a port with a permanent fake adapter. A real adapter is chosen on the date its lead time forces."
claims:
  - kind: "spec"
    target: "§2"
revisit_if: "A fake adapter drifts from its real twin and hides a production bug"
---

## DEC-010: Outside services sit behind ports with fakes; real adapters are chosen late

Muster's approach (muster's records 013 and 020, in the sibling repo), with the timing changed. Muster deferred its whole
stack for weeks; Haul has a December deadline and credentials the farm must hand over, so "late"
means the last date that still leaves room for lead time — Square and hosting by mid-November,
translation not until task 2.14. The fakes are the test substrate for good, and contract tests run
the same assertions against fake and real adapters so they cannot drift quietly.
