---
schema: 1
id: DEC-003
title: "Vercel Cron drives every scheduled run, and every run is idempotent"
topic: "Stack & hosting"
status: "active"
date: "2026-10-25"
ruling: "Scheduled work runs from Vercel Cron; each run is safe to fire twice or to miss, because work is recorded before it is done and picked up by the next run."
claims:
  - kind: "spec"
    target: "§7.3"
revisit_if: "A missed or doubled run actually costs a member a charge or an email, or volume outgrows one cron invocation"
---

## DEC-003: Vercel Cron drives every scheduled run, and every run is idempotent

Vercel Cron does not promise exactly-once delivery, so correctness cannot depend on it. The charge
run writes a ledger row before charging and uses it as the idempotency key; a run that dies leaves
pending rows for the next one, and a run that fires twice finds the work done. The ledger is the
queue, so no queue service is needed.

A queue such as Inngest or QStash stays behind a port until a missed run actually happens. A run
that never fires at all is caught by the health endpoint sheepdog polls, not by cron itself.
