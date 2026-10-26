---
schema: 1
id: DEC-011
title: "Vitest and ESLint; the gate type-checks, lints, tests and builds"
topic: "Stack & hosting"
status: "active"
date: "2026-10-26"
ruling: "Tests run on Vitest 5, colocated as *.test.ts. ESLint guards the core's boundary. `npm run verify` runs the doc checks, both type-checks, lint, tests and the build, in that order."
claims:
  - kind: "spec"
    target: "§4"
revisit_if: "The gate takes long enough that it gets skipped, or a test needs a browser"
---

## DEC-011: Vitest and ESLint; the gate type-checks, lints, tests and builds

Muster's tooling (`muster/package.json`, `muster/vitest.config.ts`), with one change: Vitest 5, as
centerline runs it, not muster's 4. Vitest 4 on current Vite 8 crashed npm's install on
2026-10-26 — Vite's optional devtools peer pulls Vitest 5 into the peer set beside 4.

Lint covers `app/`, `src/`, the project's own tests and configs — not jig's `scripts/`, which this
repo may not edit and which fail the recommended rules. Type-aware rules stay off. The core's
boundary is a `no-restricted-imports` rule on `src/**`: no Next, React or `app/` (see also DEC-001).
