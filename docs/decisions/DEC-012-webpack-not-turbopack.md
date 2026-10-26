---
schema: 1
id: DEC-012
title: "Dev and build run on webpack, not Turbopack"
topic: "Stack & hosting"
status: "active"
date: "2026-10-26"
ruling: "`next dev` and `next build` run with --webpack, using `experimental.extensionAlias` to map the core's `.js` specifiers to `.ts`."
claims:
  - kind: "spec"
    target: "§4"
revisit_if: "Turbopack resolves `@core/money.js` to `src/money.ts` without help"
---

## DEC-012: Dev and build run on webpack, not Turbopack

Tried, not assumed. On Next 16.4.3, Turbopack fails `next build` on `app/page.tsx`'s
`import { formatUsd } from "@core/money.js"`: "Module not found: Can't resolve '@core/money.js'
… aliased to relative './src/money.js'". It does not apply `.js` → `.ts` mapping. Webpack with
`extensionAlias` builds and prerenders `/`. Muster reached the same answer (`muster/next.config.ts`).

The core keeps its `.js` specifiers because NodeNext and Vitest need them (see also DEC-001,
DEC-011). Dropping them to please the bundler would cost the core its portability.
