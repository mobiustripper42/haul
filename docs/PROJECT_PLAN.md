# Haul — Project Plan

**Start date:** 2026-10-24
**Target:** Supper Club on sale mid-December 2026 (Phase 1); running unattended before the first
January 2027 pickup (Phase 2).
**Critical path:** Square production credentials and DNS for `members.ohiocityfarm.com` from the
farm — both have lead time code cannot make up.

---

## Estimation Method

Fibonacci scale (2, 3, 5, 8, 13). See `VELOCITY_AND_POKER_GUIDE.md` for definitions.
All estimates from planning poker between Eric and Claude, 2026-10-24/25. Where we disagreed, the
higher number won.
Tests are baked into every task estimate — no separate testing tasks.
Every screen is two designs, desktop and mobile, and the points include both.

---

## Phase 0: Foundation

Docs, the skeleton, the data layer, and the cross-cutting pieces every later task stands on:
translation, email, auth, the admin guard and audit.

| # | Task | Points | Notes |
|---|------|--------|-------|
| 0.1 | Scaffold commit, spec, context, plan, future ideas, first decision records | 3 | |
| 0.2 | Next skeleton, framework-free core, the gate | 3 | Muster's tsconfig split and `@core/*` alias; check whether webpack is still needed |
| 0.3 | Local Postgres, migrations, repository port with in-memory and Postgres adapters | 5 | Contract test runs both adapters; TLS inside the constructor |
| 0.4 | i18n: translation files, language resolution, Spanish proof page | 3 | Lint rule fails on a bare string |
| 0.5 | Email port: fake and Resend adapters, templates through i18n | 2 | Fold candidate with 0.6 |
| 0.6 | Email-code auth: 6-digit code, session, rate limit | 3 | Ported from muster |
| 0.7 | Admin role and guarded admin area | 3 | Tests: signed out, member, expired session |
| 0.8 | Audit by trigger on every table | 5 | **@architect pass.** Test fails if a table lacks the trigger |

**Phase 0 total: 27 pts**

**Ejection point:** the environment is trustworthy. Nothing user-facing exists yet.

**Demo:** the gate, green, from a clean checkout; a page in Spanish; signing in by code.

---

## Phase 1: Supper Club on sale

A member can sign up, pay for their first week and hold one of the ~50 spots. Due mid-December.

| # | Task | Points | Notes |
|---|------|--------|-------|
| 1.1 | Seeded Supper Club product: option types, options, cap, cutoff and first-pickup settings | 5 | SQL and seeds only |
| 1.2 | Square port: fake and sandbox adapters (Customers, Cards, Payments), email match | 8 | Template: muster's `fake-payment.ts` discipline |
| 1.3 | Public signup page | 5 | Pickers generated from option types |
| 1.4 | Card on file and first-week charge; ledger table | 8 | Fold candidate with 1.6 |
| 1.5 | Cap: reserve, charge, confirm or release | 3 | Muster's guarded write |
| 1.6 | Signup confirmation email | 2 | |
| 1.7 | Admin member list and CSV | 3 | Cards on mobile |
| 1.8 | Production: Vercel, Crunchy, Cloudflare, DNS, Resend, runbook | 5 | Optimistic — DNS is the farm's |
| 1.9 | Square production cutover and smoke test | 2 | Fold candidate with 1.10 |
| 1.10 | Wix link and go-live checklist | 2 | |

**Phase 1 total: 43 pts**

**Ejection point:** the Supper Club is on sale at `members.ohiocityfarm.com` and Lenny can see who
signed up.

---

## Phase 2: Runs without the developer

Everything the Supper Club needs week to week, working unattended. Due before the first January
pickup.

| # | Task | Points | Notes |
|---|------|--------|-------|
| 2.1 | Calendar: weeks, cutoff, closed weeks, moved windows, admin week closure | 8 | |
| 2.2 | Charge run against the ledger | 8 | **@architect pass.** Split at spec if it reads as 13 |
| 2.3 | Cron route, real charges, decline email and flag | 5 | |
| 2.4 | Member portal: subscription, upcoming weeks, history, contact details | 5 | Email change re-verifies |
| 2.5 | Skip one or more weeks | 3 | Cutoff enforced on the server |
| 2.6 | Switch size or preference | 3 | |
| 2.7 | Cancel | 2 | |
| 2.8 | Menu builder: library, duplicate, edit, assign; missing-menu email | 8 | Lenny builds on his phone |
| 2.9 | Weekly menu email and public menu page | 5 | |
| 2.10 | Pick list, skips CSV, printable pickup list | 3 | |
| 2.11 | Health endpoint for sheepdog | 3 | Sheepdog itself is out of this plan |
| 2.12 | Backups and witnessed restore drill | 3 | |
| 2.13 | Update card and retry declined weeks | 8 | |
| 2.14 | Menu translation: port, provider, stored translations | 5 | |

**Phase 2 total: 69 pts**

**Ejection point:** a January week runs end to end — menu out, charges in, pick list ready — with
nobody touching it.

---

## Phases 3–6 (proposal level, not estimated)

- **Phase 3 — Product builder and CSA on sale.** Admin product builder, CSA seasons, shares sold up
  front, sales page, pickup locations, portal shares and donate-a-share, season exports, Square
  member and order import. As soon as possible after Phase 2: summer shares go on sale ~Jan 1.
- **Phase 4 — Delivery.** Target ~June 1, or handled by hand at first.
- **Phase 5 — Pickup check-in.** iPad, last-name lookup.
- **Phase 6 — Reports.**

See `docs/SPEC.md` §8.

---

## Phases

One row per phase, written by `/retro` at close.

| Phase | Closed | Points | Days | Re-estimated | Net drift |
|-------|--------|--------|------|--------------|-----------|
| 0 | — | — | — | — | — |
| 1 | — | — | — | — | — |
| 2 | — | — | — | — | — |

**Points** is done / planned. **Net drift** is final points minus original estimates; positive means tasks ran bigger than pointed.

---

## Estimation Poker — Standing Disagreements

None unresolved. Disagreements on 2026-10-24/25 were settled by taking the higher number.

---

## Phase Boundary Checklist

At the end of every phase:
1. The gate is green — the one command `/kill-this` runs before every commit
2. Every check the `Proof` slot names for this project passes
3. Run `/retro` — it writes the retrospective entry in `docs/RETROSPECTIVES.md` and the phase row above
4. Return to primary planning chat — review docs against intent

---

## Cuttable Tasks (if behind)

| Task | Why it's cuttable | Move to |
|------|------------------|---------|
| 2.14 | Menus can go out in English with browser translation as the fallback | Phase 3 |
| 2.10 printable list | The pick-list counts are what the kitchen needs; the binder can survive a few weeks | Phase 3 |
