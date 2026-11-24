---
schema: 1
id: DEC-052
title: "Every charge Haul sends Square says the seller started it"
topic: "Payments"
status: "active"
date: "2026-11-23"
ruling: "Every charge sends customer_details with customer_initiated false, from Square's adapter alone; no caller chooses it, and the payments port and the fake do not change."
claims:
  - kind: "file"
    target: "src/adapters/square-payments.ts"
    note: "charge: the field on the request that creates a payment"
  - kind: "test"
    target: "src/adapters/square-payments.test.ts"
revisit_if: "A charge is declined for verification in production, or the farm takes on a country where Square requires verification for a seller-started charge"
---

## DEC-052: Every charge Haul sends Square says the seller started it

A card that asks for a bank check was declined at signup with `CARD_DECLINED_VERIFICATION_REQUIRED`, after the member
entered the code (issue 251). In a sandbox probe that sent `customer_initiated: false`, the Mastercard
5248 4800 0021 0026 and the Visa 4310 0000 0020 1019 were both paid after the bank check's code.

All three callers (signup's first charge, the weekly run, the retry after a card change) go through the one `charge`
call, so the field is sent there and nothing is chosen by a caller. Who started a charge is Square's detail, so it stays
in Square's adapter; the port and the fake are unchanged. Signup's first charge is the one where the member is present,
which Square's page says to mark buyer-started; Haul verifies them when the card is entered and marks the charge
seller-started anyway.

A charge attempted before this ships and retried after carries the same key with a different request, which the adapter
treats as a refusal; ship it with no charge in flight.
