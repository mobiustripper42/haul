---
schema: 1
id: DEC-007
title: "Configuration is edited with SQL and seeds, not admin screens"
topic: "Product rules"
status: "active"
date: "2026-10-25"
ruling: "Products, prices, the cutoff and the calendar are set by the developer with SQL and seeds. An admin screen exists only where the farm must act without the developer."
claims:
  - kind: "spec"
    target: "§2"
revisit_if: "Configuration requests from the farm arrive weekly, or the developer is unavailable when one is needed"
---

## DEC-007: Configuration is edited with SQL and seeds, not admin screens

Every admin edit screen is a screen to design twice, build and test. Most of this configuration
changes a few times a year. The screens that exist are the ones where waiting for the developer
would fail the farm: the menu builder (weekly), closing an unexpected week, and from Phase 3 the
product builder for CSA seasons. Audit by trigger (DEC-009) records SQL edits too.
