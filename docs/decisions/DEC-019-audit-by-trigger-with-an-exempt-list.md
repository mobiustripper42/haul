---
schema: 1
id: DEC-019
title: "Audit by trigger, with an exempt list"
topic: "Data model"
status: "active"
date: "2026-10-30"
ruling: "Every table is audited by the audit_row trigger except those on AUDIT_EXEMPT in db/schema-check.ts, each with its reason; the gate fails the build otherwise."
claims:
  - kind: "spec"
    target: "§7.8"
  - kind: "file"
    target: "db/schema-check.ts"
  - kind: "file"
    target: "db/migrations/20261030184507_audit_log.sql"
  - kind: "test"
    target: "db/audit-log.test.ts"
  - kind: "test"
    target: "db/schema-check.test.ts"
supersedes:
  - DEC-009
revisit_if: "An exempt table starts holding the farm's business data, or open question 17 promises erasure"
amends_spec:
  - section: "7.8"
    scope: "every table is audited except those on the exempt list, which the gate enforces"
---

## DEC-019: Audit by trigger, with an exempt list

DEC-009 said every table. `rate_limit_hits` would keep client addresses forever; `sign_in_codes` would
keep unsalted hashes of 6-digit codes, which reverse in milliseconds. The log itself and
`_migrations` are exempt too. All four sit in `AUDIT_EXEMPT` (`db/schema-check.ts`) with their reasons,
and `schemaViolations` fails the build for any other table without the trigger or a primary key
(`row_key` is built from it), and for a stale exemption.

`audit_row()` is `security definer` and records `session_user`, so the app's database user will need no
insert right on `audit_log` and cannot fake a row. The actor is set only with
`set_config('haul.actor', …, true)` inside a transaction, never per connection: a pooled connection
would carry it into the next request. `TRUNCATE` is not audited; task 1.8 withholds it from the app.
Retention and erasure wait on spec open question 17.
