---
schema: 1
id: DEC-009
title: "Every table is audited by a Postgres trigger"
topic: "Data model"
status: "active"
date: "2026-10-25"
ruling: "Every insert, update and delete on every table is written to an audit log by trigger, with who did it; a test fails the build if any table lacks the trigger."
claims:
  - kind: "spec"
    target: "§7.8"
revisit_if: "Audit volume becomes a storage or performance problem, or a table genuinely needs exemption"
---

## DEC-009: Every table is audited by a Postgres trigger

Bolting audit onto muster's reservations afterwards was a large task, so it goes in from Phase 0.
Triggers rather than application code because configuration is edited with SQL (DEC-007): an
app-level audit would never see those edits. The app sets the acting member or admin per
transaction; a psql session records the database user. The coverage test is the mechanism — a rule
that a new table needs the trigger would be prose, and prose gets skipped. Gets an @architect pass
at task 0.8.
