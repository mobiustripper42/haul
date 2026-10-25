# Haul — Ohio City Farm Supper Club & CSA Management: Requirements

Working name: **Haul** (internal only: repo, folders, dev docs). Members and the farm see it only as Ohio City Farm's Supper Club and CSA management tool; "Haul" never appears in the product.

Status: requirements gathered from the Oct 23, 2026 meeting, Lenny's notes, and follow-up decisions. Not a spec. Phases are a starting point.

## Context

- **Client:** Ohio City Farm, Cleveland. Admins: Lenny (store manager) and Michael.
- **Current tools:** Wix website (stays; the app is linked from it). Square for in-person sales on a dedicated POS and an iPad, which also runs EBT. Local Line was tried ($199/mo) and dropped as a poor fit.
- **Volume:** Summer CSA ~300 members, Fall CSA ~150, Supper Club target ~50.
- **Today's process is manual:** paper binder at pickup, and members email staff for every change.

## Products

### Supper Club (meal subscription)
- Pickup only, every Monday. The pickup day is fixed; changing it after launch is a feature change.
- Weekly auto-renewing subscription, like Amazon Subscribe & Save. No season or end date.
- Two sizes: feeds 2 and feeds 4–5. Price is ~$79/week (which size is open), and admins can edit it.
- Vegan preference: the whole box is vegan or not, with no price difference.
  - Preferences are stored as data, each with a price modifier defaulting to $0, so spicy, no-dairy etc. can be added later without code.
- Members can skip a week, switch size, or switch preference until the cutoff.
- Free gift on signup (details open).
- Capped at ~50 members; shows sold out when full.

### Traditional CSA
- Two seasons: Summer (20 weeks, starts ~June 1, sales open ~Jan 1) and Fall (6 weeks).
- Two sizes per season.
- Sold all up front as a single item.
- Capped per product; shows sold out.
- Sales page with lots of CSA info and photos.
- Account created, or login required, at purchase.
- **Fallback if not ready by Jan 1:** the farm sells summer shares in their Square store, and the app imports those orders and customers via Square's Orders and Customers APIs.

### Delivery (CSA add-on, later phase)
- Weekly recurring charge, skippable.
- Delivery zone (~10 mi) enforced at checkout and on address change.
- No routing; export names and addresses.
- Members can switch between pickup and delivery mid-season.
- Delivery members imported from a Square store sale will need to add a card in the portal.

## Core platform

- **Product builder (admin):** products, sizes, prices, caps, season dates, preferences.
- **Pickup Locations:** a separate table. Products are associated with one or more locations, each with its hours.
- **Cutoff:** a per-product setting, N days before the pickup/delivery date.
  - The weekly charge runs at cutoff.
  - Skips and changes are allowed until cutoff.
- **Menu builder (Supper Club):** one record per pickup date with two free-text descriptions, standard and vegan. The same text feeds the weekly email and a menu page on the site.
  - Lenny can build menus many weeks ahead.
  - Each week's email and site page pull that week's menu automatically.
- **Member portal:**
  - See active subscriptions and shares, plus history.
  - Edit contact info and address.
  - Skip, switch size, switch preference.
  - CSA general info: start/end dates, pickup hours, location.
  - "Donate your share" button to skip a CSA week (details open).
  - Contact info for questions.
- **Exports (CSV):**
  - Weekly pick list: counts by size × preference.
  - Member list per season.
  - Weekly skips.
  - Delivery names and addresses.
- **Multilingual (requirement):** many members are not native English speakers.
  - Build i18n in from day one, with all UI strings in translation files rather than hard-coded.
  - Each member has a language preference, and transactional emails go out in that language.
  - Admin-written content (menus, CSA notes) is machine-translated at send/publish time.
  - Browser page translation is the fallback for anything else.
  - iPad check-in should be language-light: big buttons, names, icons.
- **Admin:** one role for now (Lenny, Michael), with room for more roles.
- **Import:** ~300 existing members from Square. Each needs an email to sign in.

## Technical decisions

- **Payments: Square only,** since one processor keeps their volume together.
  - Web Payments SDK for card entry, Cards API for card on file, Payments API for charges, Customers API so online members match their POS directory.
  - The app runs its own weekly charge loop. It does not use Square's Subscriptions API, which conflicts with cutoff-based skips and swaps.
  - Dev/sandbox uses Spink's own Square account; production uses the farm's token and location ID.
  - Suggest a separate Square location for online sales so the farm's existing reports split it out.
- **Auth:** passwordless 6-digit email code (from Muster).
- **Email:** Resend.
- **Domain:** subdomains of ohiocityfarm.com. Spink is getting DNS access.
- **Hosting:** managed (Vercel and a Postgres host, as with Muster); ~$50/mo passed through to the farm.
- **Code to harvest:**
  - Bushel: same stack, farm products, weekly cutoff cadence.
  - Muster: auth, payments patterns, Twilio/A2P experience.

## Phases (draft)

0. **Foundation:** repo, harvested code, auth, admin role, Square sandbox, Resend, Pickup Locations, product builder with caps.
1. **Supper Club:** signup, weekly charge at cutoff, skip/size/preference changes, menu builder, weekly email, member portal, pick-list export.
   - **Deadline:** on sale by mid-December for a January start.
2. **CSA (pickup only):** season products sold up front, sales page, portal, donate-a-share, exports, import of ~300 members from Square.
   - **Target:** ~May 1 (season starts ~June 1).
3. **Delivery:** zone enforcement, weekly delivery charge, skips, pickup↔delivery switch, delivery export.
   - Needed by June 1 unless delivery is handled manually at first.
4. **Pickup check-in:** iPad lookup by first letters of last name, check off the box.
5. **Reports:** generic viewable reports. Square presumably already feeds their accounting.

## Constraints

- Supper Club must be sellable before year-end.
- Spink is in Mexico City for December 2026.
- Build the smallest working piece first, then layer on.

## Commercial (not settled)

- **Model:** monthly subscription. Spink keeps the code and handles maintenance and changes. Hosting is billed at cost.
- **Anchors:**
  - Local Line was $199/mo, and the farm felt it did too little.
  - 2% platforms would be ~$5k/yr, which the farm called a non-starter.
- **Draft:** $199/mo plus hosting.
- **Timeline estimate:** pending Spink's Claude Code velocity numbers.

## Questions for Lenny

1. Refund and cancellation policies: are they different for each product type?
2. What happens on a declined card (box made or not, who follows up)?
3. How are holidays handled, since several land on Monday?
4. Sales tax on prepared meals: yes? Does $79 include tax?
5. What is the free gift, and does the app need to track it?
6. Supper Club price for each size: which one is $79?
7. Supper Club commitment: cancel anytime, or a minimum? Any limit on consecutive skips?
8. Cutoff value: how many days before Monday pickup?
9. Donate a share: what happens to the share, and does it need its own report?
10. CSA share prices and size names; confirm fall is 6 weeks.
11. Delivery price, and is there a cutoff for switching pickup↔delivery?
12. Pickup locations and hours for the Supper Club vs. the CSA.
13. Do all ~300 Square members have an email on file?
14. Does Constant Contact stay for newsletters and recipes?
15. What subdomain name do they want (members., shop., etc.)?
16. Which languages do members speak, ranked by how many members use each?

## Future ideas (not in scope)

- Square volume discount: call Square sales about custom rates (commonly cited starting ~$250k/yr).
- SNAP / EBT payments.
- SMS notifications (A2P 10DLC under the farm's entity).
- Waiting list for sold-out products.
- CSA add-ons (eggs, etc.); no box customization.
- Loyalty credits.
- QR code / wallet pass at pickup.
- Wix website refresh.
- Kitchen helper: a weekly ingredient buy list, calculated from structured recipes × that week's box counts by size and preference.
