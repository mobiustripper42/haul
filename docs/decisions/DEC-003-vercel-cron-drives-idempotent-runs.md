---
schema: 1
id: DEC-003
title: "Every scheduled run is idempotent; the scheduler is chosen with the host"
topic: "Stack & hosting"
status: "draft"
date: "2026-10-25"
ruling: "Each scheduled run is safe to fire twice or to miss, because work is recorded before it is done and picked up by the next run. What fires it is the host's scheduler, chosen in task 1.8; no run is built against one scheduler's shape."
claims:
  - kind: "spec"
    target: "§7.3"
revisit_if: "A missed or doubled run actually costs a member a charge or an email, or volume outgrows one cron invocation"
---

## DEC-003: Every scheduled run is idempotent; the scheduler is chosen with the host

Drafted 2026-10-25 naming Vercel Cron and marked active; put back to draft 2026-11-13, when the
charge run reached its trigger with no host account made and no scheduled run built (Eric). The
idempotency half is the decision; the scheduler half waits for task 1.8. The charge run's trigger is
a route any scheduler can hit with a bearer secret (task 2.3), so the choice costs no rewrite.

No scheduler promises exactly-once delivery, so correctness cannot depend on one. The charge
run writes a ledger row before charging and uses it as the idempotency key; a run that dies leaves
pending rows for the next one, and a run that fires twice finds the work done. The ledger is the
queue, so no queue service is needed.

A queue such as Inngest or QStash stays behind a port until a missed run actually happens. A run
that never fires at all is caught by the health endpoint sheepdog polls, not by cron itself.
