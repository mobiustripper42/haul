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
    note: "sendCharge, settlePaid, abandonIfRefused"
  - kind: "column"
    target: "ledger.charge_source"
  - kind: "test"
    target: "src/ledger-charge.test.ts"
supersedes:
  - DEC-052
  - DEC-040
revisit_if: "Square changes charge-and-store, or paid weeks with no card saved become common"
---

## DEC-053: A member-present charge goes to the token first; the card is saved from it

Square's charge-and-store guide: CreatePayment with the card token, then CreateCard with the payment's id as its
source. Bank-check cards paid without it (DEC-052); 254 follows the guide.

**The token lives on the ledger row** while its charge is out (`ledger.charge_source`); a filled one is what "charge
out" means: the spot count, a second save's refusal, Try again and the run's lookup rule read it. The key
`ledgerId:attempt` stays fixed until the charge settles (DEC-003). A signup's row stays `pending`; a card update's claim
puts the token on the open declined row and bumps its attempt, and the row stays `declined` (DEC-042) until the card is
saved. Try again asks Square first and resends the same charge; only one Square refuses outright clears the token.

**Who started a charge**: a token's is buyer-started, a saved card's seller-started, the weekly run's included.

**The card is written at confirm**, with the rows turning paid. A failed save after the payment leaves a paid week with
no card (`card_not_saved`) and takes a card update's declined card off file; a week the run meets with no card is
declined `NO_CARD`. DEC-041 holds. Ship with no charge in flight.
