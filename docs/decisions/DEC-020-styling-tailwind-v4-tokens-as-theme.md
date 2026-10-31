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

Muster's choice, adapted.

Plain stylesheets lost because, with Tailwind's defaults cleared, an off-token value can only be
written in bracket syntax (`p-[13px]`), which one lint pattern catches. Stylesheets would need
stylelint for the same, another dependency. `app/theme.test.ts` holds `@theme` to `tokens.json` in both directions, so
the design file and the code cannot drift apart unseen.

Fonts are vendored because `next/font/google` downloads at `next build`, and failed muster's once
(`muster/app/layout.tsx:10-15`). Montserrat and Oswald load from `app/fonts/` with their open font licences
beside them (Eric, 2026-10-30). This departs from the design README's "Load both from Google Fonts".

The repo's `tokens.json` is ahead of the Design canvas by the additions of task 0.9 until Eric mirrors
them there. See also DEC-008, DEC-015.
