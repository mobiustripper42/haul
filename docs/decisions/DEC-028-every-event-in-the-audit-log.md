---
schema: 1
id: DEC-028
title: "Every audit row names who acted; events only where the trigger can't tell"
topic: "Data model"
status: "active"
date: "2026-11-03"
ruling: "The trigger records every row change; an action records an event only where the trigger cannot tell the story; every audit row names who acted; verify fails on an undeclared server action."
claims:
  - kind: "spec"
    target: "§7.8"
  - kind: "file"
    target: "src/audit-entry-points-check.ts"
  - kind: "file"
    target: "app/audit-entry-points.ts"
  - kind: "file"
    target: "db/migrations/20261104045127_audit_detail_and_actor.sql"
  - kind: "test"
    target: "app/audit-entry-points.test.ts"
supersedes:
  - DEC-025
revisit_if: "A task needs a typed detail per event kind, a write outside withActor, or the checker misses an action"
amends_spec:
  - section: "7.8"
    scope: "an event is recorded only where the trigger cannot tell, every row names who acted, and the gate fails on an undeclared action"
---

## DEC-028: Every audit row names who acted; events only where the trigger can't tell

The trigger records every row change. An action records an event only where the trigger cannot tell
the story: nothing was written (a declined card), the decision was made above the write (a link to
an existing Square customer), or it happens once in a sign-in. Events go in through `audit_event()`,
which takes a `detail`.

Every write runs inside `withActor`, one transaction that sets `haul.actor` (DEC-019), so every row
names a member, a named system actor, or nobody. The fake rolls back too.

`app/audit-entry-points.ts` declares every server action and route handler with its kinds, or why
none. `verify` fails on an undeclared entry, a stale one, an unclaimed kind, a claimed kind its
sibling test never names, and a `"use server"` outside its file's top.

Known limit: the untested-kind check is a text match. It proves a test calls `.events()` and names
the kind, not that the branch fires it.
