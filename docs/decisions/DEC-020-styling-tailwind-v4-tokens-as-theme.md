---
schema: 1
id: DEC-020
title: "Styling is Tailwind v4, its theme rebuilt from the design's tokens"
topic: "Interface"
status: "active"
date: "2026-10-30"
ruling: "Tailwind v4 through PostCSS. Its colour, radius, shadow, type, font and container defaults are cleared and rebuilt from design/design-system/tokens.json, checked both ways. Spacing keeps the 4px step. Fonts are vendored files."
claims:
  - kind: "file"
    target: "app/globals.css"
  - kind: "file"
    target: "design/design-system/tokens.json"
  - kind: "file"
    target: "app/fonts.ts"
  - kind: "file"
    target: "eslint.config.mjs"
  - kind: "test"
    target: "app/theme.test.ts"
revisit_if: "A screen needs a look the tokens cannot express without an eslint-disable line, or the tokens move to a design tool that exports a theme"
amends_spec:
  - section: "4"
    scope: "a Styling line: Tailwind v4, its theme rebuilt from the design tokens, fonts vendored"
---

## DEC-020: Styling is Tailwind v4, its theme rebuilt from the design's tokens

Muster's choice, adapted. Plain stylesheets lost: with Tailwind's defaults cleared, an off-token value
needs bracket syntax (`p-[13px]`), which one lint pattern catches; stylesheets would need stylelint.
`app/theme.test.ts` holds `@theme` to `tokens.json` both ways.

Type, spacing and container lengths are rem (the token's px ÷ 16). Desktop with a mouse sets the root to
93.75%, phones and tablets keep 100% (Eric, 2026-10-31: desktop still a little big after the 85% scale);
rem also lets a reader's browser text size apply.

Fonts are vendored because `next/font/google` downloads at `next build`, and failed muster's once
(`muster/app/layout.tsx:10-15`). Montserrat and Oswald load from `app/fonts/` with their open font licences
beside them (Eric, 2026-10-30). This departs from the design README's "Load both from Google Fonts".

The repo's `tokens.json` is ahead of the Design canvas by the additions of task 0.9 until Eric mirrors
them there. See also DEC-008, DEC-015.
