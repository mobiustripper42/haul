# Haul — UI Context (for @ui-reviewer)

What `@ui-reviewer` checks a screen against, and what `/kill-this` and `/retro` read to decide when it runs. Rules and pointers only: every value lives in a file named here, and a list of components or tokens copied into this file would be wrong the day the code moves.

## Sources

- `design/design-system/README.md` — voice, colour rules, type, spacing, accessibility. Read first; the checklist below cites it by line.
- `design/design-system/tokens.json` — every colour, type style, spacing step, radius and shadow, with its contrast ratios in each `usage`.
- `app/globals.css` — the theme as built from the tokens, and the classes the components use.
- `design/HANDOFF.md` — which mockups are approved. They are in `design/screens/approved/`; a mockup anywhere else is not a design yet.
- `docs/BRAND.md` — the brand direction the design system was written from.

## Components

Every look a screen uses is one component in `components/ui/` (DEC-024): `ls components/ui/*.tsx` lists them, and each file's comment says what it is. A screen that builds one by hand is a finding. Lint already refuses a raw element and a component's class outside that folder; it does not catch a card or notice rebuilt from token utilities (DEC-024 records the gap), so that copy is this review's to find. A look no component covers is a follow-up, not a component for the reviewer to design.

## Viewports

375px and 1440px. Tablets use the mobile design (README:37).

## Screen files and routes

- **Screen file:** a `.tsx` under `app/` or `components/`, tests excluded, and `app/globals.css`.
- **Strings file:** anything in `src/messages/`.
- **Route:** a `page.tsx` is the screen at its folder's route — `app/sign-in/code/page.tsx` is `/sign-in/code`; `find app -name page.tsx` lists them all. A change to a `layout.tsx`, or to a file under `components/` or `app/globals.css`, reaches every route whose page or layout uses it, directly or through another component.

## Languages

One file per language in `src/messages/` (`ls src/messages/`). Switch with the language switcher on the screen; a signed-in member's own language wins over the cookie (`app/language.ts:7`). A string a language lacks falls back to English (`src/messages/es.ts:3`), and that is not a finding: no translation is promised.

## Reaching a screen

`npm run db:up`, `npm run db:seed:members`, then `npm run dev` if nothing answers on port 4000. Sign in as `eric@ocf.xx` (member) or `lenny@ocf.xx` (admin) (`db/seeds/members.ts:10`); the code is at `/dev/outbox?to=<email>` (`app/dev/outbox/route.ts`). A screen still out of reach is named in the report as not reached — never reviewed from source and called clean.

## What to check

Lint already enforces tokens, contrast pairs, translated strings and the components (DEC-020, DEC-015, DEC-024). These are what it can't see:

- **One gold element per screen** (README:51).
- **Spacing on the named steps**, `space-1` to `space-12` (README:37).
- **Touch targets at least 44px tall** (README:37).
- **A state colour always with a word or icon** (README:22).
- **Voice:** short sentences, plain words, the farm's names for its things, no idioms, exclamation marks, emoji or urgency; an error says what to do next (README:9-12).
- **A hand-built copy of a component**, as above.

Wording that differs from the mockup is not a finding: the spec owns the words, and the design's wording is never used.
