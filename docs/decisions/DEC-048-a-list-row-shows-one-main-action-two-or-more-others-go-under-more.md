---
schema: 1
id: DEC-048
title: "A list row shows one main action; two or more others go under More"
topic: "Interface"
status: "active"
date: "2026-11-20"
ruling: "A list row shows one main action as a button. One other action is drawn beside it as a quiet button; two or more go under More, a menu that floats over the rows below."
claims:
  - kind: "file"
    target: "components/ui/row-actions.tsx"
    note: "RowActions: actions as data, drawn by how many others there are"
  - kind: "test"
    target: "components/ui/row-actions.test.ts"
  - kind: "test"
    target: "app/admin/weeks/page.test.ts"
revisit_if: "A list needs more than one main action, or More must open on a surface other than a row"
---

## DEC-048: A list row shows one main action

Lists carried their actions as rows of buttons, which wrap onto loose lines at 375px (Eric, 2026-11-12: "way way too many
buttons in the lists"). A row now shows one main action, a secondary button. With one other action it is drawn beside the
main one as a quiet button, as Add note was; More appears only from two others, so a menu never holds a single entry.

More is a `MenuGroup`: a `<details>` that `MenuScript` closes on Escape, an
outside tap or focus moving away. `RowActions` takes actions as data, a link or a form, so the same action is drawn as
a main button, a quiet button or a menu row by where it lands. The admin calendar is the first list on it; the others
move to it when they grow a third action.
