---
schema: 1
id: DEC-049
title: "Settings are rows in one key-value table, not product columns or env"
topic: "Product rules"
status: "active"
date: "2026-11-21"
ruling: "A number the farm or the operator tunes lives as a row in the settings table, key and text value, read through one function that falls back when the row is absent or malformed. It is written by SQL and the seed, never by an admin screen."
claims:
  - kind: "file"
    target: "src/settings.ts"
    note: "wholeNumberSetting: the one read, with its fallback and its log line"
  - kind: "test"
    target: "src/settings.test.ts"
revisit_if: "A setting needs a type other than a whole number, or the farm must change one without the developer"
---

## DEC-049: Settings are rows in one key-value table

The two reminders' day counts (issue 231) were a constant in code. A constant is edited by a deploy; a column on
`products` would need a migration for each new number and names a product for what is not about one; an environment
variable is the host's and invisible to the seed and the audit trigger. A `settings` row is edited by SQL, seeded like the
rest of the configuration (DEC-007), recorded by the audit trigger (DEC-019), and a new setting is an insert rather than a
migration.

The value is text and the core parses it. `wholeNumberSetting` reads absent as the fallback, silently, and malformed as the
fallback plus one log line naming the key, so a typo in a hand-written row neither breaks a run nor goes unnoticed. The
fallback is why production, whose seed runs once, can take its rows by a hand-run insert after the migration (`docs/RUNBOOK.md`).

See also DEC-007.
