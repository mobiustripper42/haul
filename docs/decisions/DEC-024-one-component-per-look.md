---
schema: 1
id: DEC-024
title: "Every look a screen uses is one component, and lint refuses a hand-built copy"
topic: "Interface"
status: "active"
date: "2026-11-01"
ruling: "Every look a screen uses is one component in components/ui/; lint refuses a hand-built copy outside it. A button's kind is a TypeScript type, not a class lint reads. The app aims for no lint overrides."
claims:
  - kind: "file"
    target: "components/ui/button.tsx"
  - kind: "file"
    target: "eslint.config.mjs"
  - kind: "test"
    target: "app/ui-lint.test.ts"
  - kind: "test"
    target: "components/ui/types.test.ts"
revisit_if: "A look needs a variant its component cannot take without a className"
---

## DEC-024: Every look a screen uses is one component, and lint refuses a hand-built copy

Eric (2026-11-01): "I just want to make sure I open this app someday and don't have four different
looking buttons on three screens." Seven components in `components/ui/` (`Shell`, `Card`, `Heading`,
`Field`, `Input`, `Notice`, `Button`) name the classes in `app/globals.css`; no look moves out of it.

Lint (`eslint.config.mjs`) refuses the raw element and the class outside `components/ui/`, and names the
component to use. Inside the folder only DEC-015's and DEC-020's lists apply. A `Button` takes a
required `kind` (`primary`, `secondary` or `quiet`) and no `className`, so a missing or unknown kind
fails `npm run typecheck:app` instead of a lint selector reading a class string.

A known gap: a card or a notice is a `<section>` or a `<p>`, so lint refuses its class but not a copy
of its look written in token utilities. Muster's class-string `surface` rule
(`/home/eric/muster/eslint.config.mjs:321-378`) is the model if one appears.

The search: `grep -rli --exclude-dir=archive "component" docs/decisions/` returned DEC-015, which is
about bare strings in a component, not this; `"button"` returned DEC-022, the sign-in link page's one
button, not this. New id. See also DEC-020, DEC-015.
