---
schema: 1
id: DEC-053
title: "A member-present charge goes to the token first; the card is saved from it"
topic: "Payments"
status: "active"
date: "2026-11-24"
ruling: "Signup and a card update with a week owed charge the card entered first, buyer-started, then save the card from the payment; no token is stored, and a second submit is charged under the same key."
claims:
  - kind: "file"
    target: "src/ledger-charge.ts"
    note: "takeCharge, settlePaid"
  - kind: "column"
    target: "ledger.charge_sent_at"
  - kind: "test"
    target: "src/ledger-charge.test.ts"
supersedes:
  - DEC-052
  - DEC-040
revisit_if: "Square changes charge-and-store, or paid weeks with no card saved become common"
---

## DEC-053: A member-present charge goes to the token first; the card is saved from it

Square's charge-and-store guide: CreatePayment with the card token, then CreateCard with the payment's id as its source.
Bank-check cards paid without it (DEC-052); 254 follows the guide.

No token is stored. `ledger.charge_sent_at` is when a charge with no recorded answer was sent; set, the charge is out:
the spot count, a second save's refusal and the run's lookup rule read it. The key `ledgerId:attempt` stays fixed until
the charge settles (DEC-003). A signup's row stays `pending`; a card update's claim marks the open declined row, which
stays `declined` (DEC-042) until a card is saved.

A second submit charges its card under the same key, once Square has no payment under the ledger id. Square takes one
charge per key, so the next key comes only when Square says the key is used, no payment is found and ten minutes have
passed since the stamp the row was read with. A stamp is compared before it is replaced, so a slow tab cannot end a
newer one. A charge Square refuses outright ends.

A token's charge is buyer-started, a saved card's seller-started, the run's included. The card is written at confirm;
a failed save leaves a paid week with no card (`card_not_saved`). DEC-041 holds.
