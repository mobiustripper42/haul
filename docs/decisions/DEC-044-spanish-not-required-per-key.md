---
schema: 1
id: DEC-044
title: "Spanish is not required per key; a missing key renders in English"
topic: "Interface"
status: "active"
date: "2026-11-17"
ruling: "Screens render in English. Emails render in the member's saved language, whose select starts on the browser's language if the app has it, else English. es.ts may lack a key, which renders in English."
claims:
  - kind: "spec"
    target: "§7.13"
  - kind: "file"
    target: "src/i18n.ts"
  - kind: "file"
    target: "src/messages/es.ts"
  - kind: "file"
    target: "app/language.ts"
  - kind: "test"
    target: "app/language.test.ts"
  - kind: "test"
    target: "src/messages/catalogs.test.ts"
supersedes:
  - DEC-043
revisit_if: "Screens take Spanish back, or a Spanish-language member gets an email that is partly English"
amends_spec:
  - section: "7.13"
    scope: "new strings need no Spanish; a key the Spanish file lacks renders in English"
---

## DEC-044: Spanish is not required per key

DEC-043 kept screens in English and emails in the member's language, and kept Spanish complete in
the catalogs behind a missing-key check. With no screen showing Spanish, that check made every task
write Spanish nobody reads. It is gone; the rest of DEC-043 holds.

`translate` already falls back to English for a key the language lacks (`src/i18n.ts`), and
`src/messages/es.ts` satisfies a `Partial` record, so a missing key is not a type error. `src/messages/catalogs.test.ts` still fails on a Spanish key
English lacks, and still compares placeholders, fill-ins and the legal texts' shape for the keys
Spanish has.

Emails are the one place Spanish is read. A new email gets its Spanish when it is written, checked
by the operator, with no rule in the spec template.

Searched `docs/decisions/` for "spanish": DEC-015 (strings in core catalogs) honoured; DEC-043
superseded.

See also DEC-015.
