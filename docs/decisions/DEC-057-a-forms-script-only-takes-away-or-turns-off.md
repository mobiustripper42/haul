---
schema: 1
id: DEC-057
title: "A form's script only takes away or turns off; without it the form still works"
topic: "Interface"
status: "active"
date: "2026-11-25"
ruling: "The server sends every form as a working form with no script: its button on, its dropdown waiting for that button. Only the running script takes a button away or turns one off, so a page with no script is never half a form."
claims:
  - kind: "file"
    target: "components/ui/submit-button.tsx"
    note: "withoutScript and untilChanged: the script takes away or turns off"
  - kind: "file"
    target: "components/ui/select-that-applies.tsx"
    note: "a pick sends the form once the script runs"
  - kind: "file"
    target: "components/ui/form-state.ts"
  - kind: "test"
    target: "e2e/form-changes.spec.ts"
revisit_if: "A page that cannot work without its script is allowed, or the app stops serving browsers that run none"
---

## DEC-057: A form's script only takes away or turns off; without it the form still works

Issue 235 made two forms react to what is in them: Weekly lists loads a week on a pick, and Your details' Save stays off
until a field changes. The risk in both is a page the script never reached: a dropdown changed over a list that did not,
or a Save that cannot be pressed.

So the server sends today's page: Show week there, Save on. The script takes Show week away (`withoutScript`) and turns
Save off (`untilChanged`); it adds no control and turns none on that the server sent off. Without it the page is the
page it always was.

Searched `grep -rli --exclude-dir=archive` for "no script", "on change", "unsaved", "dirty": nothing; "javascript": DEC-047
(the header works with JavaScript off), a precedent and not a ruling on forms; new id.
