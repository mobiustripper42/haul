---
schema: 1
id: DEC-053
title: "A member-present charge goes to the token first; the card is saved from it"
topic: "Payments"
status: "active"
date: "2026-11-24"
ruling: "Signup and a card update with a week owed charge the card token first, buyer-started, then save the card from the payment; a saved card's charge, the weekly run's included, stays seller-started."
claims:
  - kind: "file"
    target: "src/ledger-charge.ts"
    note: "sendCharge, settlePaid, abandonIfDead: the shared steps"
  - kind: "column"
    target: "ledger.charge_source"
  - kind: "test"
    target: "src/ledger-charge.test.ts"
supersedes:
  - DEC-052
  - DEC-040
revisit_if: "Square changes charge-and-store, or a paid week with no card saved is common enough to recover the card"
---

## DEC-053: A member-present charge goes to the token first; the card is saved from it

Square's charge-and-store guide: CreatePayment with the card token, then CreateCard with the payment's id as its
source. A card that asks for a bank check needs that order (issue 254).

**The token lives on the ledger row** while its charge is out, in `ledger.charge_source`, and that column is what "charge
out" means: the spot count, a second tab's refusal, Try again and the run's lookup-only rule read it. The key
`ledgerId:attempt` stays fixed until the charge settles (DEC-003): a card update's claim turns the declined row pending
under it, token on it, and a save while any row is pending charges nothing. Try again resends the same charge; only a
dead token abandons it.

**Who started a charge** is the caller's: a token is buyer-started, a saved card seller-started, so the weekly run and saved-card charges still send `customer_initiated: false`.

**The card is written at confirm**, in the statement that turns the rows paid. A failed save after the payment
leaves a paid week with no card (`card_not_saved`); a week the run meets with no card is declined `NO_CARD`. DEC-041
holds. Ship with no charge in flight.
