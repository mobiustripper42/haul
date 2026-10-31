---
schema: 1
id: DEC-021
title: "e2e is Playwright on one next dev server, in CI only, with a dev outbox"
topic: "Stack & hosting"
status: "active"
date: "2026-10-31"
ruling: "Browser tests are Playwright, on desktop and a 375px phone, against one next dev server on port 4100. They run as their own CI job, never in npm run verify, and read the emailed sign-in code from a dev-only outbox route."
claims:
  - kind: "file"
    target: "playwright.config.ts"
  - kind: "file"
    target: "e2e/sign-in.spec.ts"
  - kind: "file"
    target: "app/dev/outbox/route.ts"
  - kind: "file"
    target: ".github/workflows/ci.yml"
  - kind: "test"
    target: "playwright.config.test.ts"
revisit_if: "The e2e CI job reaches 40 minutes, or a bug ships that only a production build renders"
---

## DEC-021: e2e is Playwright on one next dev server, in CI only, with a dev outbox

Muster's harness, adapted (`muster/playwright.config.ts`, its pull request #1173). DEC-011's
`revisit_if` ("a test needs a browser") fires here; its ruling stands, Vitest and what `npm run verify`
runs, so this is a **see also**, not a supersede.

The server is `next dev --webpack` on 4100 with `E2E=1`, so its own `distDir` (`.next-e2e`) and dev lock
let it run beside `npm run dev` on 4000. A prebuilt `next start` would catch
production-only render bugs but needs a preview flag and meets muster's Secure-cookie trap; e2e gives
those up until the job reaches 40 minutes (Eric, 2026-10-31).

The sign-in code is read back from `GET /dev/outbox?to=<address>`, which lists what the dev `FakeEmail`
sent. It is a 404 in production and never builds an email adapter. Everywhere else it is open: on
`npm run dev` at `mill-dev:4000`, anyone on the tailnet can read a sign-in code, which before was
only in that server's console. The fake is kept on `globalThis` because Next loads
`app/services.ts` once for the action and once for the route.

The CI job has its own Postgres (DEC-014). See also DEC-008, DEC-010, DEC-012, DEC-016.
