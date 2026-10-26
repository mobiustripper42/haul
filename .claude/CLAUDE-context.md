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
- **Testing** — Vitest (DEC-011)
- **Bundler** — webpack, not Turbopack (DEC-012)
- **Dev environment** — mill-dev, over Tailscale. The app is on port 4000, because muster holds
  3000, 3200 and 3300 on mill-dev and centerline 3500 and 3600. Open it at `http://mill-dev:4000`.
  Postgres runs in Docker on port 5434, because muster holds 5432 and centerline 5433 (`npm run db:up`)

Why each was chosen: `docs/DECISIONS.md`.

## Commands

Locally-pinned binaries are spelled `npm run <script>` or `./node_modules/.bin/<bin>`, never `npx`.

```bash
# The gate — what /kill-this runs before committing
npm run verify

npm run dev                  # next dev --webpack on port 4000
npm run build                # next build --webpack
npm run typecheck            # the core, under tsconfig.core.json
npm run typecheck:app        # the app, under tsconfig.json
npm run typecheck:db         # the db/ scripts, under the core's compiler options (tsconfig.db.json)
npm run lint                 # app/, src/, db/, the project's tests and configs — not jig's scripts/
npm run test                 # vitest run; add a path to run one file. The Postgres suites skip without a database

# Database (docker-compose.yml)
npm run db:up                # Postgres 17 in Docker on port 5434; --wait until healthy
npm run db:down
npm run db:migrate           # apply pending migrations to haul_dev (or to the URL given)
npm run db:new-migration <name>   # scaffold db/migrations/<UTC stamp>_<name>.sql

# Decision records
npm run gen:decisions        # regenerate docs/DECISIONS.md after adding a record
npm run check:decisions
```

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
| **Proof** | What counts as a check written before the change | A Vitest test, colocated as `*.test.ts` beside the code (`scripts/*.test.mjs` for repo tooling), naming the acceptance criterion it covers |
| **Proof command** | How to run the checks covering what you touched | `npm run test -- <path>` |

## Median gaps

| Gap | Why the default is wrong here |
|---|---|
| Every screen is two designs, desktop and mobile, both first class | A competent default builds responsive-from-mobile and calls desktop done. Here a screen is not specced until both designs are named; tablet uses mobile |
| Configuration is edited with SQL and seeds | A default builds admin CRUD for every table. Here an admin screen exists only where the farm must act without the developer (DEC-007) |
| Refunds and store credit are manual in Square | A default payment flow includes refunds. Here the app builds neither (`docs/SPEC.md` §7.3) |
| Every UI string goes through translation files | A default hard-codes English and translates later. Here a bare string fails lint from task 0.4 on |

## Blast-Radius Triggers

None yet — no money path exists. The money paths arrive with task 1.2 (the Square port), task 1.4 (the
signup charge) and task 2.2 (the charge run), and each of those tasks adds its paths here. Until
then `/kill-this` uses its generic triggers.

## Migration Protocol (project)

Plain SQL files in `db/migrations/`, applied in filename order by `db/migrate.ts` and recorded in
`_migrations` (DEC-013). Forward only: a mistake is fixed by the next file.

- **Create one with `npm run db:new-migration <name>`**, never by hand — the UTC stamp keeps filename order chronological
- **Never edit an applied migration.** Add a new file
- **Before creating one**, `gh pr list` for open pull requests touching the same table (the shell's rule)
- **Tests never add files to `db/migrations/`** — `migrate` takes a directory, and its tests use a temporary one
- Production write protection is written in task 1.8

## Conventions

- **Money** — integer cents everywhere, never floats
- **Time** — cutoffs and pickup windows are computed in America/New_York
- **Ports** — every outside service sits behind a port with a permanent fake adapter; the fake is the test substrate
- **Audit** — every table carries the audit trigger; a test enforces it (task 0.8)

- **Core and app** — the core under `src/` never imports Next, React or `app/`; lint fails if it does. Core imports carry `.js`; the app reaches the core as `@core/<file>.js`
- **Database access** — only `src/adapters/pg-connect.ts` imports `pg`; lint fails anywhere else. It applies TLS to every connection, so a caller gets a pool or client from `createPool` / `createClient` and can't forget it (DEC-001)
- **Postgres-backed tests** — start from `TEST_DATABASE_URL` in `src/adapters/test-database.ts`, call `requireTestDatabase` (skips locally, fails when `CI` is set; DEC-014), and use a database of their own through `ensureTestDatabase`

## Workflow Notes (project)

Start empty. Add one the first time something costs you twenty minutes.
