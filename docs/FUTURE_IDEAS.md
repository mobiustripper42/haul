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
| 2026-11-11 | Load History in pages as it grows | `/account/history` (issue 155) lists every week from a member's first pickup, one row a week, and reads the whole ledger at once; it grows by about 52 rows a year | Paging or a "show earlier weeks" link needs a design at both widths | open |
| 2026-11-12 | Admin member history: one member's weeks (paid, skipped, closed, week credits) on the admin member page | The approved mockup already draws it as the Weeks card (`design/screens/approved/phase-2/AdminMember.dc.html`), and issue 139 builds that page minimal, for the cancel only | Eric: a future idea, mockup or not; the admin reads a member's weeks in SQL today | open |
| 2026-11-12 | Styling codes inside catalog strings, such as bold on part of an interpolated sentence | The cancel confirm's "Your last pickup is **{week}**" (issue 139) and similar lines in the mockups bold one part of a sentence | Every string is plain text today (`src/messages/en.ts`); markup in a catalog needs a renderer and a lint rule that still catches bare strings | open |
