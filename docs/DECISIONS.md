# Haul — Decisions

Decisions about Haul, each with an id (`DEC-###`). Ids are burned and never reused.

**Every record is schema v1** and the corpus started on 2026-10-25, so there are no frozen
records. `ruling` is the one line a person reads; `claims` say what the record asserts about the
spec or the tree; the body stays under 2000 bytes.

**One decision, one file**, at `docs/decisions/DEC-###-<slug>.md`. This index is generated: edit a
record and run `npm run gen:decisions`. `npm run check:decisions` fails the build on a stale index.

**A change of mind is a new record**, carrying `supersedes: [DEC-###]`; the old record flips to
`status: superseded` with `superseded_by`. Records that merely relate name each other in plain
**see also** prose.

Muster decisions are cited by number only ("muster's record 020"), never by id, because they live
in the sibling repo and are background, not rulings for Haul.

## Index

### Stack & hosting
- DEC-001 — Stack: Next.js, Postgres on Crunchy Bridge, Vercel
- DEC-002 — Cloudflare's proxy sits in front of Vercel
- DEC-003 — Vercel Cron drives every scheduled run, and every run is idempotent
- DEC-010 — Outside services sit behind ports with fakes; real adapters are chosen late
- DEC-011 — Vitest and ESLint; the gate type-checks, lints, tests and builds
- DEC-012 — Dev and build run on webpack, not Turbopack
- DEC-014 — CI runs the gate against Postgres; the Postgres suites skip locally, fail in CI
- DEC-016 — Members sign in by an emailed 6-digit code into a 30-day signed cookie

### Payments
- DEC-004 — Square only, charged by Haul's own loop: first week at signup, then at cutoff
- DEC-005 — Refunds and store credit are manual; a late closure earns a week credit

### Data model
- DEC-006 — Product choices are option types and options, priced by sum
- DEC-009 — Every table is audited by a Postgres trigger
- DEC-013 — Migrations are plain SQL files, named by UTC timestamp, forward only
- DEC-017 — A moment is timestamptz; a Cleveland wall-clock time is date and time

### Product rules
- DEC-007 — Configuration is edited with SQL and seeds, not admin screens

### Interface
- DEC-008 — Every screen has a desktop and a mobile design, both first class
- DEC-015 — UI strings are translated in the core, without an i18n library

_**This file is GENERATED** by `npm run gen:decisions` —
edit `docs/decisions/DEC-*.md`, not this file. `npm run check:decisions` fails on a stale index, a
duplicate id, an unknown topic, an unlanded SPEC amendment, or a reference to a decision
that does not exist._
