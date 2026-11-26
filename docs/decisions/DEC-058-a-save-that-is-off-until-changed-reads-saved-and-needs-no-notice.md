---
schema: 1
id: DEC-058
title: "A Save off until changed reads Saved, and a save that lands shows no Notice"
topic: "Interface"
status: "active"
date: "2026-11-25"
ruling: "A Save that is off until its form changes reads Saved while nothing is changed, and that is the confirmation: a save that lands shows no Notice. A save that lands is the new baseline."
claims:
  - kind: "file"
    target: "app/account/page.tsx"
    note: "Your details: untilChanged, keyed on the saved values, no Saved Notice"
  - kind: "file"
    target: "components/ui/submit-button.tsx"
    note: "untilChanged: the label while the form is unchanged"
  - kind: "test"
    target: "app/account/page.test.ts"
  - kind: "test"
    target: "e2e/form-changes.spec.ts"
revisit_if: "A form with an off-until-changed Save needs to say something a Saved label cannot, such as a partial save"
---

## DEC-058: A Save off until changed reads Saved, and a save that lands shows no Notice

Your details' Save is off until the member changes a field, and while it is off it reads Saved. That label tells the whole
story, so the Notice a save used to show on `/account?saved=1` is gone (issue 235; Eric, "the saved in the button tells the
whole story"). The actions still land on `?saved=1`; the page keys Your details' form on the saved values, so a save that
lands remounts it and the new values are the baseline.

A form refilled after a save that broke a rule keeps a plain, on Save: what was typed is not saved.

Searched `grep -rli --exclude-dir=archive` for "notice": DEC-024, DEC-041, DEC-045, DEC-049, DEC-055, none rules on a
save's Notice; new id. See also DEC-057.
