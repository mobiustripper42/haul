---
schema: 1
id: DEC-001
title: "Stack: Next.js and Postgres; the hosts are chosen when their accounts exist"
topic: "Stack & hosting"
status: "draft"
date: "2026-10-25"
ruling: "Haul is a Next.js App Router app with a framework-free domain core, backed by Postgres, local in dev. The app host and the production Postgres host are undecided: Vercel and Crunchy Bridge are candidates, settled in task 1.8."
claims:
  - kind: "spec"
    target: "§4"
revisit_if: "The charge run needs a long-lived worker, or Vercel or Crunchy pricing changes enough to matter to the farm's pass-through hosting cost"
---

## DEC-001: Stack: Next.js and Postgres; the hosts are chosen when their accounts exist

Drafted 2026-10-25 as "Next.js, Postgres on Crunchy Bridge, Vercel" and marked active; put back to
draft 2026-11-13 (Eric). Next.js, the framework-free core and Postgres are built on and enforced
(DEC-011, DEC-012). No host account exists, so the hosting half was never a decision, only the
candidates below, and a record marked active had later sessions building on a host that was not there.

Put through the mixer on 2026-10-24 rather than assumed. Rails and Laravel fit the shape best —
jobs, mailers and i18n built in — but the code worth reusing from muster is TypeScript. Railway,
Render and Fly would co-locate a worker with the database, which only matters if the charge run
needs an always-on process; it does not (DEC-003). Neon was left by muster for cost and Supabase
declined as a platform (muster's records 177 and 020, in the sibling repo).

Crunchy's self-signed root is config, applied inside every connection constructor — muster's record 177
found that putting it on the caller misses callers.
