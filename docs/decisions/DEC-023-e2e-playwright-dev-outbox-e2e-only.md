---
schema: 1
id: DEC-023
title: "e2e is Playwright on one next dev server; its dev outbox answers only there"
topic: "Stack & hosting"
status: "active"
date: "2026-10-31"
ruling: "Browser tests are Playwright, on desktop and a 375px phone, against one next dev server on port 4100, as their own CI job, never in npm run verify. They read the emailed code and link from a dev outbox that answers only there."
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
supersedes:
  - DEC-021
revisit_if: "The e2e CI job reaches 40 minutes, or a bug ships that only a production build renders"
---

## DEC-023: e2e is Playwright on one next dev server; its dev outbox answers only there

Muster's harness, adapted (`muster/playwright.config.ts`, its pull request #1173). DEC-011's `revisit_if` ("a test needs a browser") fires here; its ruling
stands, so this is a **see also**, not a supersede.

The server is `next dev --webpack` on 4100 with `E2E=1`, so its own `distDir` (`.next-e2e`) and dev
lock let it run beside `npm run dev` on 4000. A prebuilt `next start` would catch production-only
render bugs but needs a preview flag and meets muster's Secure-cookie trap; e2e gives those up until
the job reaches 40 minutes (Eric, 2026-10-31).

The sign-in code and link are read back from `GET /dev/outbox?to=<address>`, which lists what the dev
`FakeEmail` sent. It answers only when `E2E=1` and is a 404 everywhere else, production included, so
`npm run dev` no longer shows a sign-in code to the tailnet. The fake is kept on `globalThis` because
Next loads `app/services.ts` once for the action and once for the route. The server's `SITE_URL` is
its own address.

The CI job has its own Postgres (DEC-014). See also DEC-008, DEC-010, DEC-012, DEC-022.
