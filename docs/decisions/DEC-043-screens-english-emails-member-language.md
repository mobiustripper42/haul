---
schema: 1
id: DEC-043
title: "Screens are English; emails follow the member's language"
topic: "Interface"
status: "superseded"
date: "2026-11-16"
ruling: "Every screen renders in English, whatever the cookie or Accept-Language says. Emails render in the member's saved language, chosen on the create-account form, whose select starts on the browser's language if the app has it, else English."
claims:
  - kind: "spec"
    target: "§7.13"
  - kind: "file"
    target: "app/language.ts"
  - kind: "test"
    target: "app/language.test.ts"
superseded_by: DEC-044
revisit_if: "A fluent reviewer and the 375px layout check are both in place for a language"
amends_spec:
  - section: "7.13"
    scope: "screens render in English; emails follow the member's saved language"
---

## DEC-043: Screens are English; emails follow the member's language

Spanish stays complete in the catalogs (DEC-015 holds, the missing-key gate stays), but its wording has
not been reviewed by a fluent reader and its layout has not been checked at 375px. Until both happen,
no screen shows it.

`getLanguage()` in `app/language.ts` is the one place every screen asks, and it resolves English. The
header's switch, the action that set the `lang` cookie and the cookie's name are gone. A later "screens
follow X" is a change in that one function.

A member's `language` still picks the language of their email (sign-in code, sign-in link, Supper Club
confirmation). The create-account form's "Language for emails" starts on `getEmailLanguageDefault()`:
the browser's best supported `Accept-Language` match, else English; a form redisplayed after an error
keeps what the person chose.

Searched `docs/decisions/` for "language" and "spanish": DEC-015 (strings in core catalogs) honoured, not
superseded; DEC-018 and DEC-027 match incidentally.

See also DEC-015.
