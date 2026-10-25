# Haul — Project Context

Everything specific to **this** project. The `CLAUDE.md` shell reads this file at session start and treats it as authoritative for project-specific facts. Nothing here syncs from jig; it's yours to edit freely.

## What We're Building

A thin app on top of Square for Ohio City Farm (Cleveland): a weekly Supper Club meal subscription
charged at a cutoff, then CSA shares, delivery, pickup check-in and reports. Square keeps the money
and the customer directory; Haul owns cutoffs, skip and switch, the member portal, menus, pick lists
and exports. "Haul" is internal only — the product is Ohio City Farm's. Full scope: `docs/SPEC.md`.

Roles:
- **Admin** — Lenny and Michael at the farm: members, menus, week closures, exports
- **Member** — subscribes, pays, skips, switches, manages their own details and language
- **Operator** — the developer, editing configuration through SQL and seeds

## Stack

- **Web** — Next.js (App Router), one app with member and admin route groups
- **Domain core** — framework-free TypeScript, consumed by Next (muster's pattern)
- **Database** — Postgres: local in dev, Crunchy Bridge in production
- **Hosting/target** — Vercel behind Cloudflare's proxy, at `members.ohiocityfarm.com`
- **Payments** — Square only (Web Payments SDK, Customers, Cards, Payments)
- **Email** — Resend, behind a port
- **Testing** — chosen in task 0.2

Why each was chosen: `docs/DECISIONS.md`.

## Commands

Locally-pinned binaries are spelled `npm run <script>` or `./node_modules/.bin/<bin>`, never `npx`.

```bash
# The gate — what /kill-this runs before committing
npm run verify

# Decision records
npm run gen:decisions        # regenerate docs/DECISIONS.md after adding a record
npm run check:decisions
```

Development, lint and test commands arrive with task 0.2.

## Additional Docs

| File | Purpose |
|------|---------|
| `docs/BRAND.md` | Brand and visual direction — still the jig template, not yet written |
| `docs/USER_STORIES.md` | What each role does — still the jig template, not yet written |
| `docs/DEV_REFERENCE.md` | Deploy + review reference |
| `docs/FUTURE_IDEAS.md` | Ideas caught but not planned |
| `docs/sources/` | The requirements, Lenny's answers and the market scan, verbatim |

## Workflow Mechanisms

| Slot | What it answers | This project |
|---|---|---|
| **Proof** | What counts as a check written before the change | none yet — no test runner until task 0.2; until then the doc checks in `npm run verify` are the only checks |
| **Proof command** | How to run the checks covering what you touched | `npm run verify` until task 0.2 names a test command |

## Median gaps

| Gap | Why the default is wrong here |
|---|---|
| Every screen is two designs, desktop and mobile, both first class | A competent default builds responsive-from-mobile and calls desktop done. Here a screen is not specced until both designs are named; tablet uses mobile |
| Configuration is edited with SQL and seeds | A default builds admin CRUD for every table. Here an admin screen exists only where the farm must act without the developer (DEC-007) |
| Refunds and store credit are manual in Square | A default payment flow includes refunds. Here the app builds neither (`docs/SPEC.md` §7.3) |
| Every UI string goes through translation files | A default hard-codes English and translates later. Here a bare string fails lint from task 0.4 on |

## Blast-Radius Triggers

None yet — no code exists. The money paths arrive with task 1.2 (the Square port), task 1.4 (the
signup charge) and task 2.2 (the charge run), and each of those tasks adds its paths here. Until
then `/kill-this` uses its generic triggers.

## Migration Protocol (project)

Tooling is chosen in task 0.3, which fills this section. Production write protection is written in
task 1.8.

## Conventions

- **Money** — integer cents everywhere, never floats
- **Time** — cutoffs and pickup windows are computed in America/New_York
- **Ports** — every outside service sits behind a port with a permanent fake adapter; the fake is the test substrate
- **Audit** — every table carries the audit trigger; a test enforces it (task 0.8)

The rest is set in tasks 0.2 and 0.3.

## Workflow Notes (project)

Start empty. Add one the first time something costs you twenty minutes.
