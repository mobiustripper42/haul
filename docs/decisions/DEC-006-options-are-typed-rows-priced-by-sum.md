---
schema: 1
id: DEC-006
title: "Product choices are option types and options, priced by sum"
topic: "Data model"
status: "active"
date: "2026-10-25"
ruling: "Size and preference are option types with option rows priced in cents; a member picks exactly one per type and pays the sum. A new dimension is data, not code."
claims:
  - kind: "spec"
    target: "§7.1"
revisit_if: "A real requirement needs several picks within one type, or option types start carrying behaviour beyond price and counting"
---

## DEC-006: Product choices are option types and options, priced by sum

Eric's call on 2026-10-25. Pricing, signup pickers and the pick list all read options without
knowing what a type means — muster's policy/mechanism split applied to products. It gives up
multi-select within a type; the Supper Club box is whole-box vegan or not, so nothing needs it.
Watch for options sprawling into a denormalized grab bag as types are added.
