---
schema: 1
id: DEC-051
title: "Every tap shows it landed, and a sending form locks the page"
topic: "Interface"
status: "active"
date: "2026-11-23"
ruling: "Every button and in-app link shows a ring where it was tapped, and while a form is being sent its button is off and the rest of the page is locked; a link that opens a page locks nothing."
claims:
  - kind: "file"
    target: "components/ui/submit-button.tsx"
    note: "the tapped button: off, busy, ringed, the page locked"
  - kind: "file"
    target: "components/ui/link-label.tsx"
  - kind: "file"
    target: "components/ui/page-lock.ts"
  - kind: "test"
    target: "e2e/tap-feedback.spec.ts"
revisit_if: "A form needs to stay usable while it sends, or a link's page loads slowly enough to need its own lock"
---

## DEC-051: Every tap shows it landed

The ring is `Spinner`, over the words of the thing tapped, which go invisible and keep their space; a screen reader
hears the control's own name, marked busy.
`Button`'s button form is `SubmitButton`, which knows for itself that it was tapped, so no screen changes. In-app links
(`Button`, `TextLink`, `Wordmark`) hold a `LinkLabel`.

A button that sends a form is off while the form is sent, and for 600ms from the tap if the answer is quicker, so a second
tap sends nothing; the rest of the page is inert until the answer. That puts one change under every form, Pay's included.
Square's card box is spared (`data-page-lock-spare`): the form counts as being sent while Square checks the card, and a
bank check may open. A link locks nothing and holds no 600ms, or two rings would show after a change of mind.

Three buttons load a whole page (`loadsPage`) and turn off just after the browser collects the form; sooner drops which
button was tapped. The lock and the menu drawer share `holdInert`, so closing the drawer cannot unlock a page still
sending. A menu link closes its own menu on arrival (see also DEC-050), and nothing opened later.
