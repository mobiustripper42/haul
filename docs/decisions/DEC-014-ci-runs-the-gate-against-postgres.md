---
schema: 1
id: DEC-014
title: "CI runs the gate against Postgres; the Postgres suites skip locally, fail in CI"
topic: "Stack & hosting"
status: "active"
date: "2026-10-26"
ruling: "GitHub Actions runs npm run verify against a postgres:17 service on every pull request to main. Without a database the Postgres suites skip locally and fail in CI."
claims:
  - kind: "file"
    target: ".github/workflows/ci.yml"
  - kind: "file"
    target: "src/adapters/test-database.ts"
revisit_if: "A local run needs the Postgres suites to be mandatory, or the gate outgrows CI's time limit"
---

## DEC-014: CI runs the gate against Postgres; the Postgres suites skip locally, fail in CI

Muster's workflow (`muster/.github/workflows/ci.yml`), with one change: muster's Postgres suite
skips everywhere, so a CI without a database goes green without the contract having run. Haul's
`requireTestDatabase` skips only when `CI` is unset; the workflow sets `CI` itself, so the contract
cannot be skipped on a pull request. Locally, `npm run verify` stays Docker-free, and the skip
message names `npm run db:up`. See also DEC-011.
