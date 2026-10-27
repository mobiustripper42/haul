---
schema: 1
id: DEC-015
title: "UI strings are translated in the core, without an i18n library"
topic: "Interface"
status: "active"
date: "2026-10-26"
ruling: "UI strings live in TypeScript catalogs in src/messages/, read by src/i18n.ts in the framework-free core. Intl gets each language's locale, never the bare code. No i18n library."
claims:
  - kind: "spec"
    target: "§7.13"
  - kind: "file"
    target: "src/i18n.ts"
  - kind: "file"
    target: "eslint.config.mjs"
revisit_if: "A string needs something Intl and the plural keys below cannot express, or the translator grows past what a library would cost"
---

## DEC-015: UI strings are translated in the core, without an i18n library

Put to @architect on 2026-10-26, before task 0.4 was built. Task 0.5 sends email from the core,
and next-intl's framework-free half, `use-intl/core`, would make the core depend on a package
whose React dependency went unverified. Native `Intl` covers the plurals and dates Phases 1–2 need
in both languages.

Catalogs are TypeScript modules, so neither the core nor the bundler needs `.json` import settings,
and task 1.11's missing-key check can be as small as dropping `Partial` from `es`. `LANGUAGES`
carries each language's `locale` (`en-US`, `es-US`): bare `es` prints $12.34 as `12,34 US$`.

Plurals, when the first string needs one: keys `<key>.one` and `<key>.other`, chosen by
`Intl.PluralRules` under the locale, a category with no key falling back to `.other` (Spanish has
`many`). A bare string in a `.tsx` component fails lint, tests excepted. `members.language` is
checked against the supported list, so a new language is files, a review and a one-line migration.
