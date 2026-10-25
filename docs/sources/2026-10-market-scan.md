# Ohio City Farm CSA + Supper Club: Market Scan of Off-the-Shelf Tools and What Other Farms Are Doing

None of the off-the-shelf tools we found meets both of the farm's hard rules: all payments through Square, and no percentage-of-sales fee. The best path is a hybrid. Square is the commerce backbone: customer directory, card on file, payments, catalog and inventory caps, and EBT at pickup. A thin custom app sits on top and handles the CSA- and Supper-Club-specific logic that no Square-compatible product does: per-product cutoffs, skip/size/preference switching, the member portal, pick lists and the delivery zone. Every farm-specific platform that comes close either takes a cut of sales (CSAware, Farmigo, GrownBy, Open Food Network, Farmhand), runs payments through its own processor or Stripe (Barn2Door, GrazeCart, Clementine, Homegrown), or has already been tried and rejected (Local Line).\[1\]\[2\]\[3\] The one partial exception is Local Food Marketplace. It charges a flat fee and lets the farm pick its own merchant (including Square) through Authorize.net. GrownBy's 2026 guide puts it at $129 to $349 a month billed annually, plus a CSA add-on at $99 to $149 a month, so about $228+/month plus a setup fee, and it is built for food hubs.

## TL;DR

- **Buy:** no product clears both hard constraints and also handles a weekly Supper Club with cutoff-based skip/switch/preference. The closest is Local Food Marketplace: flat fee, Square possible via Authorize.net, but $129–$349/mo base plus a $99–$149/mo CSA add-on plus setup. It is the only buy option worth a demo before committing to a build.
- **Hybrid (recommended):** keep Square as the system of record and payment processor. Use Square's Customers, Cards-on-file, Payments, Catalog/Inventory and Checkout APIs. Build the scheduling, cutoff, portal, exports and check-in logic yourself. This keeps 100% of card volume on Square toward custom rates and avoids any percentage fee. It also turns the 300-member Square import into an API sync instead of a CSV migration.
- **Ideas worth stealing, ranked:** (1) a waitlist with auto-offer, since 2026 shares sold out; (2) one-tap "donate this week's share" routed to the Re:Source Pantry, extending the existing Farm Champion level; (3) the weekly menu/recipe email as a retention engine; (4) skipped weeks converted to store credit (Stillwind Farm); (5) a SNAP pay-at-pickup weekly option modeled on City Fresh and FRESHFARM; (6) multilingual, photo-first iPad check-in. Lockers, farm-stop consignment and online SNAP are real trends but belong in later phases.

## Key Findings

1. **Square is the real constraint, and most farm platforms fail it.** Barn2Door publishes its own card rate of 2.9% + $0.30 and sells its own $59 reader. GrazeCart processes through Stripe; one Capterra reviewer wrote "I'm sad that the only Credit Card payment option is Stripe."\[4\]\[5\] Clementine and Homegrown both use Stripe or in-house processing.\[6\] Open Food Network's Square integration exists only as an archived community "draft" request.\[7\] Wix cannot do it either: Wix's own help center says recurring payments are not possible with providers outside its list, naming "Braintree, Square" explicitly.\[8\]
2. **The percentage-fee rule removes most of the rest.** CSAware charges 2% of delivery revenue with a $100/month minimum.\[2\] Farmigo charges 2% with a $150/month minimum.\[3\] GrownBy's CSA plan is $50/month plus a 2% co-op fee.\[9\] Farmhand lists a 3% platform fee plus 4% card fee.\[10\] Open Food Network suggests 2% of new sales.\[1\] At about $250k of CSA revenue, a 2% fee is about $5,000/yr, the figure the farm already called a non-starter. CSAware's site says volume pricing brings fees "as low as 1% on deliveries over a set threshold": a CSA delivering $100,000/month pays $1,875. Even so, at this farm's scale the fee is in the thousands.
3. **Harvie is gone.** A farm notice posted on Harvie's own site (Cooper's CSA Farm, Dec 13, 2024) confirms it: "they are shutting down… You will not have access to your HARVIE accounts as of Dec. 31st." Several 2026 "best CSA software" listicles (mygardenspot.com, aboutagri.com) still describe Harvie as active, which suggests those pages are unreliable or machine-generated.\[11\]\[12\] Ignore them.
4. **Square alone gets you about 60% of the way, but not the Supper Club.** Square Subscriptions is free (processing only), supports weekly cadence, lets subscribers pause and resume, and emails customers a "Manage Subscription" link.\[13\]\[14\] It has no cutoff concept, no preference field, and no grouped size choice. A Square Community moderator confirmed that subscription periods cannot be "grouped" as variations when presented to customers online.\[15\] Grapevine's September 2026 comparison also notes that Square Online's built-in subscriptions apply to "shippable orders only."\[10\] That is a problem for a pickup-only Monday meal.
5. **Square's APIs are good enough to build on.** The Subscriptions API supports pause (by number of cycles or a resume date), resume, swap-plan (size change) and cancel. The Checkout API can generate hosted subscription checkout links.\[16\]\[17\] Two documented gotchas matter here. Subscriptions are billed in advance from the start date, and changing the billing anchor "can result in billing customers twice in quick succession." Also, pauses take effect at the end of the current billing period.\[18\]\[19\] For a hard "charge at cutoff" rule, the cleaner design is to store a card on file and have your own scheduler charge it via the Payments API at each product's cutoff.
6. **Volume tier:** Square's own pricing page says that if you process over $250,000 per year, you "can talk to our team about custom pricing and processing fees." Keeping all CSA and Supper Club volume on Square directly supports the farm's custom-rate goal. Square's pricing page lists online rates of 2.9% + 30¢ on Square Plus ($49/mo per location) versus 3.3% + 30¢ on Square Free ($0/mo), so the plan tier matters for a mostly-online CSA.

## Part 1 — Market Scan

### Comparison table

Legend: ✅ meets / 🟡 partial or workaround / ❌ fails / ? unverified

| Tool | Current price (2025–26) | % of sales fee? | Square as processor? | Capped prepaid seasonal shares | Weekly sub w/ cutoff skip / size / preference | Member self-service | CSV exports | Delivery zone + weekly delivery fee | API / extensibility | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| **Square (Online + Subscriptions + APIs)** | Free; Plus $49/mo per location; processing 2.9%+30¢ online on Plus | No | ✅ native | ✅ item + inventory count = sold out | 🟡 pause/swap only; no cutoff, no preference; online subs shippable-only | 🟡 basic "Manage Subscription" link | 🟡 generic CSVs | ❌ | ✅ extensive (Customers, Cards, Payments, Subscriptions, Catalog, Checkout) | **Backbone for hybrid** |
| **Local Line** | Core $109/mo (+$29 subs), Premium $199, Ultimate $399; 20% off annual | No | 🟡 Square Sync for in-person POS; online gateway options incl. Square per Grapevine, but saved cards don't cross gateways | ✅ | 🟡 skips/holds; box-builder oriented | ✅ | ✅ | ? delivery zones; exports to routing | 🟡 | Already tried and dropped; wrong model\[20\] |
| **Local Food Marketplace** | $129–$349/mo + $499–$1,499 setup; CSA add-on $99–$149/mo + $249–$499/yr package | No | ✅ via Authorize.net, farm-chosen merchant (Square, Stripe, PayPal) | ✅ (with add-on) | ? holds & reschedules ✅; preference/cutoff unverified | ✅ | ✅ robust | ✅ Routific integration (+$49–69/mo) | ? | **Only buy option worth a demo**; pricey, hub-oriented\[21\] |
| **CSAware (Small Farm Central/LocalHarvest)** | 2% of delivery revenue, $100/mo min, volume discounts | ❌ Yes | ? accepts card, eCheck, PayPal, EBT; processor unclear | ✅ | ✅ holds, customization, SNAP weekly opt-in | ✅ | ✅ "all data downloadable" | ✅ built-in delivery areas | ? | Fails % rule (~$4–5k/yr)\[2\] |
| **Farmigo** | 2%, $150/mo min (delivery months) | ❌ | 🟡 "varies by processor you choose" | ✅ | ✅ holds/swaps | ✅ | ✅ | 🟡 3rd-party routing | ? | Fails % rule\[3\] |
| **Harvie** | (was ~7%) | — | — | — | — | — | — | — | — | **Closed Dec 31, 2024**\[9\] |
| **Barn2Door** | $99–$299/mo annual or $119–$379 monthly + $399–$599 setup; extra service fee in legal terms per third parties | 🟡 disputed | ❌ own processing 2.9%+30¢ | ✅ incl. pro-rata late joins | 🟡 no customizable CSA | ✅ | ✅ | ✅ Routific | ? | Fails Square |
| **GrazeCart** (POS Nation) | Starter $89/mo; subscriptions on Growth (quote only); per-subscriber fees reported | 🟡 per-subscriber | ❌ Stripe only | ✅ | ✅ subscriptions w/ customer portal | ✅ | ? | ✅ delivery zones | ? | Fails Square; meat-farm focus\[22\]\[23\] |
| **GrownBy** (co-op) | CSA plan $50/mo + 2% co-op fee | ❌ | ❌ Stripe | ✅ (no size dropdown on CSAs) | ✅ vacation→credit, SNAP weekly opt-in | ✅ app | ✅ | 🟡 export only | ? | Fails both |
| **Farmhand** | $0–$200/mo + 3% platform + 4% card | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ routing | ? | Fails both |
| **Open Food Network (US)** | Suggested 2% of sales $251–$5,000 | ❌ | ❌ (Square only a community draft) | 🟡 | 🟡 standing orders, Stripe | 🟡 | ✅ | ? | ✅ open source | Fails both\[1\]\[7\]\[24\] |
| **Clementine** | $29/mo or $169/yr flat | No | ❌ Stripe | ✅ fixed share sizes | ? | ✅ | ✅ pack-out list | ? | ? | Cheap, flat; fails Square\[9\] |
| **Homegrown** | $10/mo | No | ❌ in-house 2.9%+30¢ | 🟡 | 🟡 | 🟡 | ? | ? | ? | Fails Square; small-vendor tool |
| **Wix Stores / Pricing Plans** | Core and up; Pricing Plans fee 4% Core / 2% Business / 0% Business Elite | 🟡 by plan | ❌ Square not supported for recurring | 🟡 | ❌ | 🟡 | 🟡 | ❌ | 🟡 Velo | Fails Square\[8\]\[25\] |
| **Shopify + Copia / Loop / Recharge etc.** | Shopify $29/mo + Copia $29/mo (farm reported ~1% fee); Loop $99/mo + 1%/order | ❌ often | ❌ Square not a Shopify gateway | ✅ w/ Copia | 🟡 robust apps carry % fees | ✅ | ✅ | 🟡 apps | ✅ | Fails both; poor sales UX per farm |
| **Subport (Square app)** | From $30; Self-Service $90/mo per location, flat | No | ✅ deposits to Square | ❌ | ❌ built for coffee-style credit memberships | 🟡 branded app | ? | ❌ | ? | Wrong product shape |
| **WooCommerce Subscriptions + Square plugin** | Annual license (verify) + hosting | No | ? Square plugin; recurring support unverified | 🟡 | 🟡 needs extra plugins | 🟡 | ✅ | 🟡 plugins | ✅ | Plausible but brittle, second website beside Wix |

**Not verified / not found in current sources:** Member Assembler, Csa2go, Farmers Web, Agrimarket, Tend (Tend is primarily crop-planning software, not CSA commerce), Bold, Appstle, Seal, Recharge and dedicated meal-kit SaaS. None turned up evidence of Square-native recurring billing. Shopify-ecosystem subscription apps inherit Shopify's processor limits. Treat these as unlikely fits, but they are unconfirmed.

### Requirement-by-requirement notes

- **Capped prepaid seasonal shares (summer ~300, fall ~150, two sizes):** almost everything handles this, including plain Square: one item, two variations, inventory count, automatic sold-out state. This part does not justify a custom build on its own.
- **Supper Club (weekly, cutoff-charged, skip/size/vegan switch, ~50 cap, free gift):** this is the deciding requirement. Only CSA-specific platforms model holds and cutoffs, and all of them fail Square or the percentage rule. Square handles the money but not the rules. Build this piece.
- **Member portal + "donate your share":** no Square-compatible product offers it. Custom.
- **Pick list by size × preference, weekly skips, delivery list CSVs:** custom, but simple SQL exports once the data lives in your own database.
- **10-mile delivery zone + skippable weekly delivery charge:** no Square-native option. Custom geocode-and-radius check at checkout and on address change; the charge is a separate line in the weekly scheduler.
- **Import 300 members from Square:** in a hybrid, this is a Customers API read rather than a migration. It is a real advantage over any third-party platform.
- **Passwordless login, email, iPad check-in:** custom (magic-link email or SMS one-time code). Square Plus includes some SMS marketing capacity, but transactional texting from your own app (e.g., Twilio) gives more control.

### Verdict: hybrid, with one demo first

1. **Before building,** spend one hour on a Local Food Marketplace demo. Ask specifically: (a) can Square be the merchant behind Authorize.net for recurring weekly charges, (b) can a weekly subscription charge at a per-product cutoff with member skip/size/preference changes, and (c) what is the all-in annual cost with the CSA add-on and success package. If all three answers are yes and the cost is under about $3,500/yr, it is a legitimate buy. Expect it to fall short on the Supper Club's preference/cutoff logic and on simplicity.
2. **Otherwise build a hybrid:**
   - **Square (off the shelf):** payments online and in person, Customer Directory (source of truth for contact data), card-on-file vault, catalog items and inventory counts for share caps, receipts, EBT on the iPad, reporting and reconciliation.
   - **Custom app (linked from Wix):** product/season builder; per-product cutoff scheduler that charges Supper Club cards on file at cutoff; skip/size/preference/donate actions; member portal with magic-link login; pickup-location model; pick-list and member/skip/delivery CSV exports; delivery-zone validation; weekly menu publishing (email plus a public JSON/HTML page Wix can embed); iPad check-in by last name.
   - **Design call:** charge with your own scheduler rather than Square Subscriptions. Square's billing anchors, in-advance billing and end-of-period pause semantics fit poorly with "charge exactly at cutoff, and changes are allowed until then." Saved cards plus Payments API calls keep every charge on Square while you own the timing.
3. **Why not a full custom build?** Rebuilding payments, card vaulting, receipts, refunds and POS would be wasted effort. Square already does all of it, and the farm wants it to.

## Part 2 — What Other Farms and Farm Stops Are Doing

Ranked by value to Ohio City Farm × feasibility in this app.

| Rank | Idea | Who's doing it | Why it works | Feasibility in this app |
|---|---|---|---|---|
| 1 | **Waitlist with auto-offer** | Ohio City Farm's own 2026 shares are sold out | Captures demand you're turning away; refills cancellations automatically | High. Small feature on the cap/sold-out logic |
| 2 | **One-tap "donate this week" → pantry** | Ohio City Farm's "Farm Champion" level already "includes an extra share donated directly to a family in need via the Re:Source Pantry" | Turns skips into impact instead of waste; on-mission | High. Already in scope; add pantry tally reporting |
| 3 | **Weekly menu/recipe content as retention** | Shared Legacy Farms (Toledo area) includes "weekly meal plans & preservation tips from our CSA Coach & dietitian"; Ohio City Farm already sends weekly recipe newsletters | Members who know how to cook the box renew | High. The Supper Club menu publisher can double as the CSA "what's in the box + recipe" email |
| 4 | **Skip → store credit instead of lost share** | Stillwind Farm (MI, on GrownBy): "Once a vacation week is claimed… we will add your credit ($20 or $35 / pickup) to a Stillwind Market Card." Fresh Fork Market loads seasonal store credits | Removes the main CSA complaint (missed weeks) and drives farm-stand spend | Medium. Square gift cards/credit can hold the balance; your app issues it\[26\] |
| 5 | **Frictionless Supper Club skipping & cutoffs** | Farmhouse Delivery "Supper Club" (TX): "click a button to skip your delivery that week," $12/serving, min. 4 servings; Laurel Glen Farm (CT) requires 48 hours' notice because shares are packed the day before | Proves the model; one-click skip reduces churn more than discounts do | High. Core of your build |
| 6 | **Benchmark the Supper Club price** | Pasture and Plenty (Madison, WI): three chef meals/week, $93.50/wk for 2 people, billed every 4 weeks, $35 sign-up fee | Shows $79/wk is competitive; sign-up fee + free gift is a known pattern | N/A (pricing input) |
| 7 | **SNAP-friendly weekly pay-at-pickup tier** | City Fresh (Cleveland): week-to-week model, sliding scale (single share $22 full / $13 limited-income / $11 SNAP); FRESHFARM (DC): $42 family share is $8 for SNAP, 2,459 SNAP-paid shares in 2025; Grow Ohio Valley: 50% off with SNAP | SNAP can't be charged more than a week ahead, so pay-weekly-at-pickup fits the rules; the iPad already runs EBT | Medium. "Pay at pickup" flag + check-in screen; online SNAP (Forage/TotilPay) is later and requires FNS online authorization\[27\] |
| 8 | **Multilingual, photo-first check-in** | Ohio City Farm's own team (refugees from at least 7 countries; "the soft chatter of Swahili") — we found **no** CSA doing multilingual member comms | A real differentiator for non-native-English members; check-in by last name + photo/icons reduces binder errors | Medium. Language preference field, translated templates, big-button iPad UI |
| 9 | **Add-on shop with weekly cutoff** | Fresh Fork Market (Cleveland): extras "by end of day Tuesday," omnivore/vegetarian/vegan shares, weekly payment option ($39.75 small / $56 large / $37.50 mini) | Raises revenue per member using the same pickup | Medium. Reuses Supper Club cutoff engine (future phase)\[26\]\[28\] |
| 10 | **Pro-rated late joins** | Barn2Door markets "Pro-Rata Payments for Seasonal Subscriptions" | Sells shares after June 1 instead of leaving caps unfilled | Medium. Price = weeks remaining × weekly rate\[10\] |
| 11 | **Third (winter) season** | Ohio City Farm trialed a winter CSA with 30 members (Ideastream, Mar 2026) | Year-round revenue now that the farm has a permanent facility | High. Make the season builder generic, not hard-coded to two seasons |
| 12 | **Smart lockers / after-hours pickup** | Munsee Meats (IN) QR-code refrigerated lockers; NNEMAP Food Pantry (Columbus) refrigerated lockers, 9,000+ fills | Pickup outside staffed hours | Low now (capex); QR codes in pickup emails are cheap groundwork |
| 13 | **Farm-stop consignment retail** | Argus Farm Stop (Ann Arbor): farmers keep 70%, $30M paid to farmers through 2025, café ≈⅓ of sales but ~½ of profit, 20+ farm stops nationally; Local Roots (Wooster, OH): co-op with 18% / 20% / 25% commission tiers | Year-round outlet for many growers; café subsidizes margins | Low for this app; strategic option for the farm stand\[29\]\[30\] |

**Ohio SNAP-match context:** Produce Perks, Ohio's $1-for-$1 SNAP match (up to $25/day at markets), says on its own site that "due to the USDA's unexpected termination of our major federal grant award," the program "is paused in some regions of Ohio beginning April 1, 2026." WDTN (Mar 18, 2026) reported that 39 counties take part and about 20,000 Ohioans would lose access. Some regions continue on named local funders: the United Way of Greater Cincinnati and the Carol Ann and Ralph V. Haile, Jr. Foundation keep Hamilton and Clermont counties running "throughout 2026," a Sisters Health Foundation grant keeps it at the Athens Farmers Market, and Produce Perks' May 22, 2026 county list shows Cuyahoga County still operating. Any SNAP-incentive feature should be configurable on a per-program basis rather than built around one funder.

## Recommendations

1. **Phase 1 (target: live by Jan 1 sales open):** Square-backed CSA share sales with caps, accounts created at purchase, member portal (view shares, edit contact, donate-a-week), CSV exports, Square customer import, magic-link login, waitlist.
2. **Phase 2 (Supper Club):** cutoff scheduler charging card on file; skip/size/preference; weekly menu publisher (email + Wix-embeddable page); signup gift flag on the first pick list.
3. **Phase 3:** delivery add-on with radius check and weekly charge; iPad check-in (last name + photo, multilingual); pay-at-pickup SNAP tier; skip-to-credit.
4. **Commercial:** move to Square Plus (online rate 2.9% vs 3.3%) unless custom rates arrive first, and ask Square for custom pricing once combined volume passes $250k/yr.\[31\]
5. **Do the Local Food Marketplace demo** to close the "irresponsible not to check" loop, and record the answers.

## Caveats

- Many pricing comparisons come from **vendors' own blogs** (Clementine, Homegrown, Local Line, Barn2Door, Farmzz), which carry commercial bias. Barn2Door's disputed "service fee" and GrazeCart's per-subscriber fee come from competitors.\[4\]\[32\] Grapevine's September 2026 comparison is the most neutral source but contains referral links.\[10\]
- Local Food Marketplace's Square-via-Authorize.net support and its cutoff/preference features are **unverified beyond Grapevine's table**. Confirm in a demo.
- Square plan and processing rates changed in November 2025 (per-location plan pricing).\[10\] Re-check before quoting the farm.
- Member Assembler, Csa2go, Farmers Web, Agrimarket and several Shopify subscription apps were **not individually verified** for 2026.
- Delivery-zone, skip and export capabilities marked "?" mean we found no current documentation either way.

## Sources

1. [Pricing](https://about.openfoodnetwork.net/?page_id=114)
2. [CSAware](https://csaware.com/)
3. [Farmigo — CSA Management Software for Farms, Herdshares & Food Hubs](https://farmigo.com/)
4. [Barn2Door Pricing (2026): Plans, Fees & Total Cost](https://farmzz.com/en/blog/barn2door-pricing-review)
5. [GrazeCart Software Reviews, Demo & Pricing - 2026](https://www.softwareadvice.com/ecommerce/grazecart-profile/)
6. [FarmSite Alternative for Small Farms and CSA Operators](https://findhomegrown.com/blog/farmsite-alternative)
7. [Square Integration \[DRAFT\] - (Archived) - Open Food Network Community](https://community.openfoodnetwork.org/t/square-integration-draft/1924)
8. [Request: Additional Payment Providers for Accepting Recurring Payments](https://support.wix.com/en/article/request-additional-payment-providers-for-accepting-recurring-payments)
9. [CSA software pricing explained: flat fee vs. a percentage of every sale — Clementine CSA](https://clementinecsa.com/guides/csa-software-pricing)
10. [Comparing CSA Sales Platforms — Grapevine Local Food Marketing](https://www.grapevinelocalmarketing.com/resources/comparing-csa-sales-platforms)
11. [Best CSA Management Software for Small Farms (2026)](https://mygardenspot.com/articles/best-csa-management-software-farms)
12. [Best Farm Management Software for CSA Subscriptions (2026 Guide) - About Agri](https://aboutagri.com/farm-management-software-csa-subscriptions/)
13. [Pause and Resume Square Subscriptions](https://community.squareup.com/t5/Product-Updates/Subscriptions-pause-and-resume/ba-p/338358)
14. [Subscription Management - Subscription Billing](https://squareup.com/us/en/subscriptions)
15. [Solved: Multiple Subscription Offers - The Square Community](https://community.squareup.com/t5/Online-Store/Multiple-Subscription-Offers/m-p/756538)
16. [Subscriptions API - Square API Reference](https://developer.squareup.com/reference/square/subscriptions-api)
17. [Checkout API](https://developer.squareup.com/docs/checkout-api)
18. [Subscription Billing and Invoices](https://developer.squareup.com/docs/subscriptions-api/subscription-billing)
19. [Pause, Resume, or Cancel Subscriptions](https://developer.squareup.com/docs/subscriptions-api/pause-resume-cancel-subscriptions)
20. [Pricing for Farms](https://www.localline.co/suppliers/pricing)
21. [How to Choose CSA Software for Your Farm (2026 Guide)](https://coop.grownby.com/resources/guides/how-to-choose-csa-software)
22. [Local Line vs GrazeCart: Pricing Compared (2026)](https://findhomegrown.com/blog/local-line-vs-grazecart)
23. [Homegrown vs GrazeCart: Pricing Compared (2026)](https://findhomegrown.com/blog/homegrown-vs-grazecart)
24. [Subscriptions - OFN User Guide - Open Food Network](https://guide.openfoodnetwork.org/basic-features/subscriptions)
25. [Wix Payments Fees and Payment Options (US, 2026) - eSEOspace](https://eseospace.com/blog/wix-payments-fees/)
26. [Summer Farm Share Overview - Fresh Fork Market](https://freshforkmarket.com/summer-farm-share/)
27. [Market Share CSA](https://www.freshfarm.org/market-share)
28. [Fresh Fork Markets](https://csalogin.freshforkmarket.com/shop/category/subscriptions/)
29. [A Farmer’s Market All Week Long - Offrange](https://ambrook.com/offrange/farm-finance/farm-stop-for-you)
30. [Argus Farm Stop's Impact Through 2025 — Argus Farm Stop - Farmers Market Meets Grocery Store](https://www.argusfarmstop.com/farm-stop-blog/2026/9/3/2025-annual-update)
31. [Square POS Pricing - Plans, Hardware & Processing Fees in 2026](https://koronapos.com/blog/square-pos-pricing/)
32. [Barn2Door vs. GrazeCart: 2026 Comparison for Independent Farmers — BARN2DOOR](https://www.barn2door.com/blog-all/barn2door-vs-grazecart-2026-comparison-for-independent-farmers)
