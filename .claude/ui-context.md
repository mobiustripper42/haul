# Haul — UI Context (for @ui-reviewer)

What `@ui-reviewer` checks a screen against, and what `/kill-this` and `/retro` read to decide when it runs. Rules and pointers only: every value lives in a file named here, and a list of components or tokens copied into this file would be wrong the day the code moves.

## Sources

- `docs/BRAND.md` — voice, colour rules, type, spacing, accessibility, with every decision made after the handoff. Read first; the checklist below cites it by line.
- `design/design-system/tokens.json` — every colour, type style, spacing step, radius and shadow, with its contrast ratios in each `usage`.
- `app/globals.css` — the theme as built from the tokens, and the classes the components use.
- `design/HANDOFF.md` — which mockups are approved. They are in `design/screens/approved/`; a mockup anywhere else is not a design yet.

Not a source: `design/design-system/README.md` is the handoff as uploaded, and `docs/BRAND.md` supersedes it where they differ (body size, the 40px floor, field labels). Don't read it.

## Components

Every look a screen uses is one component in `components/ui/` (DEC-024): `ls components/ui/*.tsx` lists them, and each file's comment says what it is. A screen that builds one by hand is a finding. Lint already refuses a raw element and a component's class outside that folder; it does not catch a card or notice rebuilt from token utilities (DEC-024 records the gap), so that copy is this review's to find. A look no component covers is a follow-up, not a component for the reviewer to design.

## Viewports

375px and 1440px. Tablets use the mobile design (BRAND.md:64).

## Languages

Every language the switcher offers (`LANGUAGES`, `src/i18n.ts:10`), not a fixed list: a screen is reviewed in each.

## Screen files and routes

- **Screen file:** a `.tsx` under `app/` or `components/`, tests excluded, and `app/globals.css`.
- **Strings file:** anything in `src/messages/`.
- **Route:** a `page.tsx` is the screen at its folder's route — `app/sign-in/code/page.tsx` is `/sign-in/code`; `find app -name page.tsx` lists them all. A change to a `layout.tsx`, or to a file under `components/` or `app/globals.css`, reaches every route whose page or layout uses it, directly or through another component.

## Reaching a screen

`npm run db:up`, then start a review server of your own on port 4100, with the env `playwright.config.ts:30-39` sets:

```
E2E=1 SITE_URL=http://localhost:4100 DATABASE_URL=postgres://haul:haul@localhost:5434/haul_test_e2e RESEND_API_KEY= EMAIL_FROM= SQUARE_ACCESS_TOKEN= SQUARE_LOCATION_ID= SESSION_SECRET=e2e-session-secret-not-for-use-0123456789 ./node_modules/.bin/next dev --webpack --port 4100
```

The port and the database are the e2e suite's: never run the review while `npm run test:e2e` runs, which reuses a server left on 4100 and empties that database on every test. The database exists only once something has made it — on a fresh Docker volume, `docker compose exec -T postgres createdb -U haul haul_test_e2e` first. Prepare it with `npm run db:migrate <that url>` and `npm run db:seed:members <that url>`. Sign in as `eric@ocf.xx` (member) or `lenny@ocf.xx` (admin) (`db/seeds/members.ts:10`); the code is at `http://localhost:4100/dev/outbox?to=<email>`, which answers only on a server started with `E2E=1` (`app/dev/outbox/route.ts:10`). Never use the server on port 4000: its outbox answers 404 and its codes print in a terminal you can't read. When done, stop your server and empty its database with `npm run db:reset:dev <that url>`.

A screen still out of reach is named in the report as not reached — never reviewed from source and called clean.

## What to check

Lint already enforces tokens, contrast pairs, translated strings and the components (DEC-020, DEC-015, DEC-024). These are what it can't see:

- **One gold element per screen** (BRAND.md:34, :82).
- **Spacing on the named steps**, `space-1` to `space-12` (BRAND.md:64).
- **Every control at least 40px tall** (BRAND.md:68).
- **A state colour always with a word or icon** (BRAND.md:41).
- **Voice:** short sentences, plain words, the farm's names for its things, no idioms, exclamation marks, emoji or urgency; an error says what to do next (BRAND.md:13-20).
- **A hand-built copy of a component**, as above.

Wording that differs from the mockup is not a finding: the spec owns the words, and the design's wording is never used.
