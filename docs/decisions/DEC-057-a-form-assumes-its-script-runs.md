---
schema: 1
id: DEC-057
title: "A form assumes its script runs: the server sends it as the script keeps it"
topic: "Interface"
status: "active"
date: "2026-11-26"
ruling: "A form that changes with its script is sent as the script keeps it, with no fallback for a page whose script never runs."
claims:
  - kind: "file"
    target: "components/ui/submit-button.tsx"
    note: "untilChanged: the server sends Save off"
  - kind: "file"
    target: "components/ui/select-that-applies.tsx"
  - kind: "test"
    target: "e2e/form-changes.spec.ts"
revisit_if: "Loads without their script prove common for Haul's users, or a form must work without it"
---

## DEC-057: A form assumes its script runs: the server sends it as the script keeps it

Issue 235's first version kept its two forms working with no script: Show week sent, Save sent on, the script taking
one away and turning the other off. On a slow load the page is drawn before its script runs, so every slow load showed
a button that vanished or a Save that flipped, and the page moved under the person using it.

That guarded something rare: the British government's web service measured about 1% of visits without their JavaScript (2013, 2016). For Haul the
causes are a deploy while a page is open, fixed by a refresh, and our own bugs. A page with no script does not help on a
bad signal either: every tap is a whole page. Taking a card already needs Square's script.

So Weekly lists has no Show week, and Your details' Save is sent off, reading Saved. Eric: "a belt is fine in this case.
We don't need any suspenders"; "Just because we can write code doesn't mean we should". DEC-047's header is unchanged.

Search: "no script", "on change", "unsaved", "dirty" found nothing; "javascript" found DEC-047, not a ruling on forms.
Rewritten in place before pull request #270 merged; nothing on `main` was built on the first version.
