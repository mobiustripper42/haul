---
schema: 1
id: DEC-046
title: "A comp is a subscription column, written by db:comp"
topic: "Product rules"
status: "active"
date: "2026-11-18"
ruling: "A comp is a real subscription with comped true, set only by npm run db:comp. enrolWeek writes each of its weeks paid at 0 cents, so it is never charged, and COMPS_COUNT_TOWARD_CAP decides whether comps count toward the cap."
claims:
  - kind: "file"
    target: "db/comp.ts"
    note: "db:comp, the one writer of a comp"
  - kind: "file"
    target: "src/comps.ts"
    note: "compsCountTowardCap, true only for COMPS_COUNT_TOWARD_CAP=true"
  - kind: "test"
    target: "db/comp.test.ts"
revisit_if: "The farm comps people without the developer, or a comp needs to pause"
---

## DEC-046: A comp is a subscription column, written by db:comp

The operator needed a member, Eric, to hold a real Supper Club subscription that is never charged: on the pick list and
the pickup list, able to skip, switch and cancel, with no card.

A comp is a column, `subscriptions.comped`, not a product or a price. It is keyed on the subscription because a member
may hold several (DEC-026). `enrolWeek` writes each week of a comped subscription `paid` at 0 cents, the third reason
for such a row beside a week credit and a free pick, and a credit still wins; DEC-034 stands, for it still enrols only
the week whose cutoff last passed. Nothing else changes: the charge run finds no `pending` row to charge.

`npm run db:comp <email> [url] [--production]` is the only writer, with its own SQL in one transaction (no screen, DEC-007).
It refuses an unknown member, one already holding an active Supper Club subscription, and a non-local database address
without `--production`, as `db:seed supper-club` does. It connects with the address passed (DEC-037).

Comps do not count toward the cap unless `COMPS_COUNT_TOWARD_CAP` is `true`; the repository is built with that setting,
since it counts held spots in two places. See also DEC-007, DEC-026.
