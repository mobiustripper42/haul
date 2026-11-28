# Haul — Future Ideas (the shiny-object parking lot)

Companion to `docs/SPEC.md`. The spec is the build baseline; **new ideas land here, not there** — however good they sound at 11pm.

This is not a backlog you're committed to. It's a holding pen so a new idea can be *caught* without *derailing* the build. An idea here costs nothing and blocks nothing; an idea folded into the spec costs a baseline change.

## How to use this
- New idea → drop it in the Parking lot below with one line of *why*. Done. Go back to what you were building.
- Don't design it here. A title + a sentence is enough to stop it rattling around your head.
- When a batch is genuinely ready to fold in, that's a deliberate spec revision — not a drip.
- Be honest in the "Verdict" column over time: most shiny objects are correctly *never built*.
- Nothing tends this file for you. Dedupe it, cross-reference it, and keep the index below in sync by hand — or let it get untidy, which costs less than the tidying does.

## Prioritized index

Not ranked yet. The market scan's own ranking of other farms' ideas is in
`docs/sources/2026-10-market-scan.md` Part 2.

### HIGH — next up
| Feature | One-liner | Detail |
|---|---|---|
| Admin gives a member a credit week | Goodwill for a mistake without charging then refunding in Square; reuses week credits | Parking lot, 2026-11-18 |
| _(unranked)_ | | |

### MED — strong, not first
| Feature | One-liner | Detail |
|---|---|---|
| _(unranked)_ | | |

### LATER — someday / maybe
| Feature | One-liner | Detail |
|---|---|---|
| _(unranked)_ | | |

## Parking lot

The chronological archive — the source of detail and provenance. New ideas append as a dated row. Never reorder or delete history; a wrong idea correctly *stays* logged with a `dropped` verdict.

| Date | Idea | Why tempting | The catch | Verdict |
|------|------|--------------|-----------|---------|
| 2026-10-23 | Square volume discount | Custom rates are commonly cited from ~$250k/yr; keeping all volume on Square is the point | A call to Square sales, not code | open |
| 2026-10-23 | SNAP / EBT payments, incl. a pay-at-pickup weekly tier | City Fresh and FRESHFARM run it; SNAP can't be charged more than a week ahead, so weekly fits; the iPad already runs EBT | Online SNAP needs FNS authorization; Ohio's SNAP match is paused in some regions | open |
| 2026-10-23 | SMS notifications | Muster has Twilio/A2P experience | A2P 10DLC registration under the farm's entity | open |
| 2026-10-23 | Waiting list with auto-offer for sold-out products | Market scan's top idea: the farm's 2026 shares sold out | Offer expiry and charge timing | open |
| 2026-10-23 | CSA add-ons (eggs etc.) with a weekly cutoff | Fresh Fork does it; reuses the cutoff engine | No box customization — add-ons only | open |
| 2026-10-23 | Loyalty credits | Retention | Needs store credit, which is manual for now | open |
| 2026-10-23 | QR code / wallet pass at pickup | Cheap groundwork for lockers or fast check-in | Check-in (Phase 5) first | open |
| 2026-10-23 | Wix website refresh | The site is the front door | Not this app | open |
| 2026-10-23 | Kitchen helper: weekly ingredient buy list from structured recipes × box counts after cutoff | Lenny orders Tuesdays from the counts | Needs structured recipes; menus are free text today | open |
| 2026-10-24 | Skip → store credit instead of a lost share | Stillwind Farm does it; removes the main CSA complaint | Store credit is manual (spec §7.3) | open |
| 2026-10-24 | Pro-rated late CSA joins | Sells caps after June 1 | Pricing rule per season | open |
| 2026-10-24 | Third (winter) season | The farm trialed a 30-member winter CSA | Seasons are data already (spec §6.2) | open |
| 2026-10-24 | Weekly menu/recipe content as CSA retention | The Supper Club menu publisher can carry a CSA "what's in the box" email | Constant Contact may already own this | open |
| 2026-10-24 | Smart lockers / after-hours pickup | Pickup outside staffed hours | Capital cost | open |
| 2026-10-25 | Admin editing of public page copy | Lenny changes his own copy | Developer edits it for now | open |
| 2026-10-25 | Browser analytics from Vercel | Know what devices members use | — | open |
| 2026-10-25 | Admin dashboard | Declines, missing menus, stalled runs in one place | The emails cover it first | open |
| 2026-10-25 | Single-week Supper Club sales to fill skipped spots | Skips free capacity every week | One ledger row with no subscription | open |
| 2026-10-25 | Translator role: farm staff correct machine translations | Kitchen team speaks the members' languages | Translations already stored with a machine/human marker | open |
| 2026-10-25 | Refunds and store credit in the app | Less manual work | Muster showed it multiplies payment complexity | open |
| 2026-10-25 | Free signup gift, tracked | Raised at the Oct 23 meeting | Lenny never confirmed it | open |
| 2026-11-02 | Admin audit-log page: a member's history, row changes and sign-in events, as one timeline | The farm reads a member's history without the developer | A query does it today; an admin screen waits until the farm must act without the developer (DEC-007) | open |
| 2026-11-06 | A Square customer tool: a link manager, name mismatches between Haul and Square, and a directory sync | Task 1.4 links a member to a Square customer by email and stops there (names stay in Haul, a customer Haul creates carries email only), and the farm merges duplicates in Square by hand | A sync is a choice of which side owns each field; task 2.4 may push a confirmed email change one way, Haul to Square | open |
| 2026-11-02 | A member adds another subscription: a second box, or a second product | Households taking two boxes; the data model already allows it (DEC-026) | Written for one box today: signup, the account page and cancel (§7.6), the week credit (§7.2), one menu email per member however many boxes (§7.5), a pickup list line per box (§7.11) and a check-in tick per box (§8.5) | open |
| 2026-11-06 | Bouquet subscriptions, likely 2027 | The farm may sell flowers on the same subscription model | The spec does not describe the product yet | open |
| 2026-11-06 | HTML emails, starting with the signup confirmation | Task 1.6 ships the confirmation as plain text, laid out from the approved mockup `design/screens/approved/phase-1/ConfirmEmail.dc.html` | A second body per email, and a way to check each client renders it | open |
| 2026-11-07 | Gift a box: a member buys a subscription in someone else's name | Lenny asked for it (`docs/sources/2026-11-07-lenny-answers.md`, answer 1) | Two people on one subscription: who picks up, who gets the emails, whose card; builds on adding another subscription, above | open |
| 2026-11-07 | A member turns off receipts and confirmations | For a member who complains about the email | Default is to over-send: they are charged weekly and must pick up (Eric). Receipts always send today (`docs/SPEC.md` §7.12) | open |
| 2026-11-07 | Pickup reminder email before each window | Members must come Sunday or Monday or the meal is lost | One more email a week, with the menu email already planned (task 2.9) | open |
| 2026-11-09 | A translation service for the app's own strings | A service the app sends the catalog to and gets every language back from, by usage or a monthly fee, relying on nobody at the farm | Task 1.11 ships Spanish written by the Lead, unreviewed; DEC-010 picks the service at task 2.14 for admin-written text, so this would reuse that choice for the catalog | open |
| 2026-11-09 | `[CONTACT EMAIL]` in the legal text filled from `FARM_CONTACT_EMAIL` (`app/services.ts:92`) as a real substitution | The farm's address would be set once, in configuration, not left as a bracket in the stand-in text | Legal text can't hide a sentence when the variable is unset the way the sold-out card does (`app/supper-club/sold-out-card.tsx:19`) | open |
| 2026-11-10 | Holiday warning on the admin calendar | A standard holiday (Christmas, New Year's, the weekend after Thanksgiving and others) falls on a pickup day of a week still open and not moved, and nobody notices until members arrive | A holiday list is a table of dates that needs keeping up; Lenny closes and moves weeks by hand on the calendar today (`docs/SPEC.md` §7.2) | open |
| 2026-11-10 | Reopen a week closed by mistake after its cutoff | An admin closes a week by accident and the cutoff passes before anyone notices | A week closed before its cutoff was charged to nobody, and one closed after it gave every subscription a week credit that may already be spent. Undoing either means charging or taking back by hand; the developer does it in SQL today. After the cutoff a closure stands (`docs/SPEC.md` §7.2) | open |
| 2026-11-11 | Load History in pages as it grows | `/account/weeks#history` (issue 155, on the Upcoming weeks page since issue 243) lists every week from a member's first pickup, one row a week, and reads the whole ledger at once; it grows by about 52 rows a year | Paging or a "show earlier weeks" link needs a design at both widths | open |
| 2026-11-12 | Admin member history: one member's weeks (paid, skipped, closed, week credits) on the admin member page | The approved mockup already draws it as the Weeks card (`design/screens/approved/phase-2/AdminMember.dc.html`), and issue 139 builds that page minimal, for the cancel only | Eric: a future idea, mockup or not; the admin reads a member's weeks in SQL today | open |
| 2026-11-12 | Styling codes inside catalog strings, such as bold on part of an interpolated sentence | The cancel confirm's "Your last pickup is **{week}**" (issue 139) and similar lines in the mockups bold one part of a sentence | Every string is plain text today (`src/messages/en.ts`); markup in a catalog needs a renderer and a lint rule that still catches bare strings | open |
| 2026-11-12 | Hide a menu from the library; delete one that was never on a week | The library only grows (issue 140 builds no delete), and a duplicate made by mistake stays in the list and in the Weeks picker | A week holds a reference to its menu, not a copy, so deleting a menu that is on a week would leave that week with none; a hidden menu needs a way back | open |
| 2026-11-12 | A help or FAQ page, starting with week credits | The close-week email (issue 151) says only "you have a week credit"; what one is, when it lands and that a cancelled member is refunded by hand is explained nowhere a member can read | Wanted (Eric, 2026-11-12), not yet scheduled. Each answer is catalog text in every language, and must stay true as the rules change (`docs/SPEC.md` §7.2) | open |
| 2026-11-16 | CSA: a member names a friend to collect their share on a week they'll miss, in place of a skip | The farm's FAQ already tells members to send a friend, neighbour or colleague when they're out of town, and an uncollected share is donated through the Re:Source Pantry program. Recording the name lets check-in know who is coming | No CSA spec yet. The name needs a place on the week's pickup list and at check-in (Phase 5), and the CSA skip rule isn't settled; see "Skip → store credit", 2026-10-24 | open |
| 2026-11-18 | Admin gives a member a credit week | Goodwill for a mistake without charging then refunding in Square; reuses week credits | `week_credits.granted_for` must point at a paid week today, so a goodwill credit needs it nullable and a change to how `enrolWeek` picks a credit | open |
| 2026-11-18 | Calendar feed members subscribe to on iPhone and Android | Pickups in the member's own calendar | Muster has this code to port | open |
| 2026-11-20 | A pickup frequency other than every week, such as every 2 weeks | A member who wants a box every other week skips every second week by hand today (Eric, from the meeting with Lenny) | Every subscription is weekly today; what else assumes a box a week is not yet looked into | open |
| 2026-11-25 | What a comped member sees: Upcoming weeks say "Charged at the end of {date}" though nothing is charged, and Your account offers Update your card, which always fails for a member with no Square customer | A comped member (issue 194, `db:comp`) is never charged; the Coming row's line is the same for every subscription (`account.weeks.charged`, `app/account/weeks/page.tsx`) | The account page already shows its charge line to a comped member (`app/account/page.test.ts`, AC22), so a different line is a rule for both pages, not one. Hide Update your card for a comp, which needs no card (DEC-046); and log a save that finds no Square customer, which leaves no trace today (`src/update-card.ts:53`) | open |
| 2026-11-27 | Non-breaking spaces in the Spanish catalog (`src/messages/es.ts`): a same-month week name such as "6 y 7 de diciembre" held to its "y" and its month | Issue 272 holds the English catalog line `admin.weeks.titleSameMonth`; Spanish emails and screens wrap that name oddly without the same holds | Translations are on hold (standing rule), so `es.ts` stays untouched; the date words come from the locale formatter, which already holds single days | open |
| 2026-11-27 | A moved week's full name in Weekly lists' closed week select at 375px, which now clips it ("Saturday, December 5 and Sunday, D") | Lenny picks weeks there on his phone; @ui-reviewer rated it low on pull request #274, and it was there before that task | Moved weeks are a few a year (a guess); the phone's own picker shows the full name when the select opens, and the lists below carry the week's dates. A fix is a shorter closed label or a wrapping select, a coding task after Phase 2's last. Revisit if Lenny mentions it | open |
| 2026-11-28 | A cancelled member's rejoin while a paid week is still to come: an undo of the cancel within the cap, or a guard on the join page until that week passes | A cancel keeps its paid week (`app/account/subscriber.ts:15`), and a rejoin is a fresh signup with a fresh first charge, so a cancel and a rejoin in one week charges twice and puts the name on that week's pickup list twice (issue 276, closed as not planned; Eric's test runs on dev, not a member) | No real cancels yet, so the rarity is a guess; a double charge is repaired afterwards, and even the guard runs on every signup. The fallback: the name twice on the pickup list is the signal, Lenny refunds one week in Square, and an accidental cancel is restored by the developer in SQL (written into the handbook, issue 147). Revisit if a real member does this once | open |
| 2026-11-28 | Admins edit a member's information on the admin member page | Raised at issue 263's spec (Eric): the farm corrects a name, email or phone without the developer | Email is the login and the Square match key, so an admin's change needs the same re-verify a member's own does (`docs/SPEC.md` §7.6); the developer changes it in SQL today | open |
