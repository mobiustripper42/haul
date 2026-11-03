---
schema: 1
id: DEC-027
title: "Product, option type and option names are data"
topic: "Data model"
status: "active"
date: "2026-11-03"
ruling: "Product, option type and option names are data: a name column on each row, in the farm's words, edited with SQL until the Phase 3 product builder. They are translated as admin-written text is (§7.5), not through the message catalog."
claims:
  - kind: "spec"
    target: "§7.1"
  - kind: "spec"
    target: "§7.7"
revisit_if: "A name needs a plural or a placeholder, or the farm needs names in a language before stored translations exist"
amends_spec:
  - section: "7.1"
    scope: "each option type and option has a name the farm writes"
  - section: "7.7"
    scope: "product and option names are data, translated as admin-written text, not catalog strings"
---

## DEC-027: Product, option type and option names are data

Eric, 2026-11-02: "words are data". The Supper Club's sizes and preferences are the farm's words,
and the Phase 3 product builder will let the farm change them, so they live on the rows (`products`,
`option_types`, `options`) rather than in `src/messages/`. A name is English until stored
translations exist (task 2.14, or the product builder), as menus are (§7.5). A blank name is
refused by the `nonblank_text` domain.

See also DEC-006 (one pick per option type, priced by the sum) and DEC-015 (UI strings live in the
message catalog; these names are not UI strings).
