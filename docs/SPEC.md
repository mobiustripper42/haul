# Haul — Product Specification

Haul is the internal name: repo, folders, dev docs. Members and the farm see only Ohio City Farm's
Supper Club and CSA management tool; "Haul" never appears in the product.

Sources this spec was written from, kept verbatim in `docs/sources/`:
`2026-10-23-requirements.md` (the Oct 23 meeting, Lenny's notes, follow-up decisions),
`2026-10-24-lenny-answers.md` (Lenny's answers and the Supper Club copy), and
`2026-10-market-scan.md` (background research). Where this spec and a source disagree, this spec is
current.

## 1. Overview

Ohio City Farm (Cleveland) sells a weekly meal subscription (the Supper Club) and seasonal CSA
shares. Today it runs on a paper binder at pickup and email to staff for every change. Haul is a
thin app on top of Square: Square keeps the money, the customer directory and the in-person POS;
Haul owns what Square cannot do — cutoff-based weekly charging, skip and switch, the member portal,
menus, pick lists and exports. It is linked from the farm's Wix site, which stays.

Volume: Supper Club capped at ~50, Summer CSA ~300, Fall CSA ~150.

## 2. Philosophy

- **The smallest unit that gets a job done, then layer on.** Each task ships one working piece.
- **Decide late, behind adapters.** Everything outside the domain core — payments, email,
  storage, translation, geocoding — sits behind a port with a permanent fake adapter. A real
  adapter is chosen on the date its lead time forces, not before.
- **Every screen has a desktop design and a mobile design, both first class.** Tablet uses mobile.
  No screen ships mobile-only or desktop-only.
- **Configuration is edited with SQL and seeds** by the developer, not through admin screens,
  unless a screen is named in a phase below. Admin screens exist only where the farm must act
  without the developer (the menu builder, closing a week, and from Phase 3 the product builder).
- **Language-light for members who are not native English speakers.** Every UI string is
  translatable — in translation files, never hard-coded (§7.13 says which languages are filled in).

## 3. Target

- **Supper Club on sale:** mid-December 2026 (end of Phase 1).
- **Supper Club runs unattended:** before the first January 2027 pickup (end of Phase 2). The weekly
  charge, skips, menus and pick lists must work without the developer present.
- **CSA summer shares:** sales open ~Jan 1, season starts ~June 1. Until Phase 3 ships, the farm
  sells shares in its Square store and Phase 3 imports them; the sooner Phase 3 lands, the fewer to
  import.
- **Critical path:** from the farm — Square production credentials, DNS for
  `members.ohiocityfarm.com`, their existing legal text (open question 17), and an answer to open
  question 13. Each has lead time the code cannot make up.

## 4. Stack

- **Web framework** — Next.js (App Router), one app with member and admin route groups.
- **Domain core** — framework-free TypeScript in `src/`, consumed by Next (the muster pattern).
- **Database** — Postgres. Local Postgres in dev; Crunchy Bridge in production, TLS applied inside
  every connection constructor.
- **Hosting** — Vercel, behind Cloudflare's proxy (Origin CA cert, SSL Full (Strict)).
- **Scheduler** — Vercel Cron, driving idempotent runs.
- **Payments** — Square only: Web Payments SDK, Customers, Cards, Payments APIs. No Square
  Subscriptions API.
- **Email** — Resend, behind an email port.
- **Translation** — a machine-translation provider behind a translation port, chosen at task 2.14.
- **Domain** — `members.ohiocityfarm.com`.
- **Dev environment** — mill-dev; local Postgres. The dev server is on port 4000. Lenny previews
  through a Tailscale share of mill-dev (one user).
- **Monitoring** — sheepdog (a separate project) polls Haul's health endpoint.
- **Testing** — Vitest; the gate is `npm run verify`.
- **Bundler** — webpack, not Turbopack, for the core's `.js` imports.

## 5. Roles

- **Member** — subscribes, pays, skips, switches, manages their own details and language.
- **Admin** — Lenny (Farm Store and Kitchen Coordinator) and Michael. Sees members, builds menus,
  closes weeks, exports lists. Stored as a role, not a flag, so more roles can come later.
- **Operator** — the developer, editing configuration through SQL and seeds.

## 6. Products

### 6.1 Supper Club

- A weekly auto-renewing subscription with no end date. Pickup only.
- Sizes (placeholder prices until the farm confirms): **2 person, $50** and **3–4 person, $80**.
- Preference: **standard or vegan**, whole box, no price difference.
- Members can cancel any time, skip any number of weeks, and switch size or preference, each until
  that week's cutoff.
- Capped at ~50 active subscriptions; the signup page shows sold out when full.
- No sales tax on the Supper Club or the CSA.

### 6.2 CSA (Phase 3)

- Seasons are data (summer 20 weeks, fall 6 weeks to be confirmed; a winter season must fit
  without code). Two
  sizes per season, sold up front as one purchase, capped per product.
- A sales page with CSA information and photos. Account created or login required at purchase.
- No cancellations. A share not picked up is donated to Re:Source Cleveland's Pantry Program for
  Newcomers; the app records a member's "donate this week" if they press it, and needs no
  donation report.
- Import of the ~300 existing members and any shares sold in the Square store, matched on Square
  customer ID. Lenny says every member who has bought online has an email on file.

### 6.3 Delivery (Phase 4)

- A CSA add-on, charged weekly ($11.25 now, may rise), skippable, cancellable any time until
  cutoff, switchable with pickup.
- A delivery zone (~10 mi, being re-evaluated) enforced at checkout and on address change.
- No routing; export names and addresses. The Supper Club is never delivered.

## 7. Core concepts

### 7.1 Options

Each product has **option types** (size, preference) and each type has **options**, each with a
price in cents. A member picks exactly one option per type; the price is the sum of the chosen
options. Signup shows one picker per type; the pick list counts each combination. A new dimension
(e.g. heat: mild/spicy) is a new type in data, not code. Multi-select within a type is not
supported.

### 7.2 Calendar

This section is the Supper Club's calendar. CSA and delivery windows and cutoffs are set in Phases 3
and 4.

- **Pickup window:** Sunday and Monday. Members do not choose a day; they come either day.
- **Cutoff:** the end of Monday (midnight going into Tuesday), Cleveland time — Lenny orders on
  Tuesdays. One setting row, changeable by SQL. All changes and the weekly charge key off it.
  Which window a cutoff closes is open question 1.
- **Closed weeks:** the weekend after Thanksgiving, Christmas and New Year's have no pickup and no
  charge. Closed weeks are seeded by their window's date.
- **Moved windows:** holiday weeks may move to Saturday and Sunday.
- **Unexpected closure:** an admin can close an upcoming week from a screen (the kitchen burned
  down). Before cutoff nobody is charged; after cutoff payments are sorted out by hand.

### 7.3 Payments and the ledger

- Square is the processor and the customer directory. At signup a member is matched to an
  existing Square customer by email; one match links, none creates, several links the most
  recently updated and logs the rest for the farm to merge in Square.
- **The first week is charged at signup**, for the first pickup on or after the product's
  **first-pickup date** (a seeded setting; the Supper Club starts in January 2027) whose cutoff has
  not passed. Every later week is charged by the app's own run at cutoff, on the card on file.
- **The ledger** is one row per subscription per pickup week, written before any charge, keyed
  unique on subscription and week (whether a member can hold several subscriptions is open
  question 13). It is the work queue for the charge run and the source of all history: paid,
  skipped, closed, declined.
- Every charge carries an idempotency key derived from its ledger row, so a retried or overlapping
  run never charges twice. Money is integer cents.
- **Declined card:** the box is still made. The member gets an automatic email to update their
  card, is flagged for the admin, and saving a new card retries the declined weeks.
- **Refunds and store credit are manual**, done by the farm in Square. The app builds neither.

### 7.4 Cap

A signup reserves a spot under the cap before any charge, confirms it after the charge succeeds,
and releases it if the charge fails. A held spot with a payment attempt never expires on its own.
Nobody is charged and then refused.

### 7.5 Menus and translation

- Menus are records in a library: a standard text and a vegan text. Admins find, duplicate and
  edit them, and assign one to each pickup week, as far ahead as they like — on phone or desktop.
  (The library replaces the requirements' one-record-per-date model; Eric, 2026-10-25.)
- Admins get an email when a week coming up soon has no menu.
- Each week the assigned menu goes out by email to members picking up that week and appears on a
  public menu page.
- Admin-written text is machine-translated once per menu per language and stored, each row marked
  machine or human. A human translation is never overwritten by a re-translation.

### 7.6 Member portal

Subscription, upcoming weeks with skip and switch, history from the ledger, contact details and
language, card update, cancel. Changing email re-verifies it, since email is the login and the
Square match key.

### 7.7 Multilingual

All UI strings live in translation files from day one, enforced by a lint rule that fails on a bare
string in a component. Each member has a language preference; transactional email goes out in it.
Browser page translation is the fallback for anything else. English and Spanish first; the farm's
real language list is an open question.

### 7.8 Audit

Every table is audited by Postgres trigger: table, row, operation, before and after, when, and who.
The app sets the acting member or admin per transaction; SQL sessions record the database user.
A test fails the build if any table lacks the trigger.

### 7.9 Auth

Passwordless: a 6-digit code by email, signed session cookie, rate-limited per IP with Cloudflare's
client IP trusted only from Cloudflare's ranges (muster's pattern).

### 7.10 Operations

A health endpoint reports database reachability, the last charge run, any week pending past its
cutoff, and the last backup — polled by sheepdog. Backups are Crunchy's plus an independent nightly
dump, with a restore drill run once before the unattended period. Runtime errors on member pages
alert the developer too; the recipient and channel are decided when task 2.11 is specced.

One full rehearsal week (task 2.16) runs in production after the rest of Phase 2 is done and
before the first real January charge, on a real Monday cutoff. Which Monday depends on open
questions 1, 2 and 5. Test members are charged real money and refunded by hand in Square.

Who owns the service accounts is open question 18.

### 7.11 Exports

CSV: the member list, the weekly pick list (counts by option combination), weekly skips, a printable
pickup list by last name (until check-in in Phase 5), and from Phase 4 delivery names and addresses.

### 7.12 Consent and legal pages

Signup states the recurring charge plainly next to the pay button — amount now, amount weekly at
cutoff, until cancelled, and how to cancel — behind a required checkbox, and records what the member
agreed to and when. Terms and privacy pages use the farm's existing legal text, have desktop and
mobile designs, and exist in English and Spanish; the farm reviews the Spanish legal text. Every
email carries a footer linking them, built into the shared email template.

Only the weekly menu email can be unsubscribed from; the preference is a field on the member.
Sign-in codes, signup confirmation and declined-card notices always send.

### 7.13 Languages

The Phase 0–2 goal is **translatable**: every string in translation files. Spanish is the one
language filled in — a machine pass and a review at task 1.11, and from then on each task adds the
Spanish for its own new strings. A check in the gate fails when a key is missing from a language
file, from task 1.11 onward. Further languages are files plus a review.

## 8. Phases

Detail and points live in `docs/PROJECT_PLAN.md`.

### 8.0 Phase 0 — Foundation
Docs, the Next skeleton and gate, Postgres with the repository port, i18n, email, auth, admin role,
audit triggers.

### 8.1 Phase 1 — Supper Club on sale
Seeded product and options, the Square port, signup with card and first charge, the cap, the
confirmation email, the admin member list, production, Square cutover, go-live, the Spanish pass,
consent wording and legal pages.

### 8.2 Phase 2 — Runs without the developer
The calendar, the charge run, cron and declines, the member portal, skip, switch, cancel, menu
builder, menu email and page, menu translation, pick list, card update and retry, health endpoint,
backups, the admin handbook, and a rehearsal week in production.

### 8.3 Phase 3 — Product builder and CSA on sale
Admin product builder, CSA seasons and shares sold up front, sales page, pickup locations, portal
shares and donate-a-share, season exports, Square member and order import.

### 8.4 Phase 4 — Delivery
Geocoding port, zone check, weekly delivery charge on the Phase 2 run, skips, pickup↔delivery
switch, delivery export, card add for imported members.

### 8.5 Phase 5 — Pickup check-in
An iPad screen: find a member by the first letters of their last name and check off their box.
Big buttons, little text.

### 8.6 Phase 6 — Reports
Viewable reports, scoped once the farm says what Square does not already give them.

## 9. Open questions

1. Is the cutoff reading right: Monday midnight closes the following Sunday/Monday window?
2. Does the signup charge always pay for the first pickup on or after the first-pickup date whose
   cutoff has not passed? And the exact first-pickup date in January 2027.
3. Supper Club size names and prices. Working values: 2 person $50, 3–4 person $80 (Eric's
   working sizes; the requirements said "feeds 2" and "feeds 4–5" at ~$79).
4. The free gift: confirm it is dropped.
5. Is the benefit week a closed week, and which weeks move to Saturday/Sunday?
6. Which languages do members speak, ranked?
7. Does Constant Contact stay for newsletters and recipes?
8. Pickup location and hours for the Supper Club and the CSA.
9. CSA share prices and size names; confirm fall is 6 weeks.
10. Delivery zone size, and any cutoff for switching pickup↔delivery.
11. Between going on sale (Phase 1) and the portal (Phase 2), how does a member cancel or change a
    signup? Proposed: by emailing Lenny, applied by the developer in SQL.
12. DNS: does the farm move `ohiocityfarm.com`'s nameservers to Cloudflare (the zone also carries
    the Wix site and email), or is a single-subdomain setup possible on their plan?
13. **Blocks task 1.1.** One Supper Club subscription per member, or several (a household taking
    two boxes)?
14. Receipts: does Square email the receipt for each charge, or does the app?
15. Price changes: do existing subscribers keep their price, or move to the new one with notice?
    Settle before the real prices are seeded.
16. Email sender: which farm address sends, which inbox receives replies, and who adds the email
    authentication records (SPF, DKIM, DMARC) to the farm's DNS?
17. The farm's existing terms of service and privacy policy text, for task 1.12. Does it promise
    members deletion or export of their data? If so, deferring deletion (Out of scope) may not
    hold — and the audit log keeps before/after rows, so it needs an @architect pass.
18. Service accounts (Vercel, Crunchy, Resend, Cloudflare, the Square developer app): proposed
    that the farm owns and pays for all of them, so it can keep running without the developer.
    Going to the farm in Eric's proposal; not yet agreed. Task 1.8 creates the accounts.

## 10. Out of scope

No phase above plans these. Ideas worth keeping are in `docs/FUTURE_IDEAS.md`.

- Refunds and store credit in the app — manual in Square
- Square Subscriptions API — the app runs its own charge loop
- Delivery routing — export only
- A free signup gift — dropped pending open question 4
- Admin editing of public page copy
- Multi-select options within one option type
- SMS
- Member data deletion requests — deferred; what the farm promises is not yet decided
