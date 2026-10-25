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
