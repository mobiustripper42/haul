---
schema: 1
id: DEC-059
title: "A week's name keeps the full month, a single day the short one, a month its day"
topic: "Interface"
status: "active"
date: "2026-11-27"
ruling: "A week's name keeps the full month, a single day in a sentence takes the short month, and a month never breaks from its day: one formatter, U+00A0 inside the date, the space after a weekday's comma breakable."
claims:
  - kind: "file"
    target: "src/pickup-week.ts"
    note: "held, formatPickupDate, formatShortDate, weekTitle: the one home of the rule"
  - kind: "file"
    target: "src/messages/en.ts"
    note: "admin.weeks.titleSameMonth: the holds in the catalog line"
  - kind: "test"
    target: "src/pickup-week.test.ts"
revisit_if: "A mail client shows the non-breaking space as a stray character, or Spanish catalog lines come off hold"
---

## DEC-059: A week's name keeps the full month, a single day the short one, a month its day

The account card's pending-switch line wrapped between a month and its day at 375px (issue 257). The rule is every
date's, through the formatters rather than page by page: `formatPickupDate` defaults to the short month ("Monday, Nov
30"), a week's name asks for the full one ("December 6 and 7"), and a private `held` puts U+00A0 for every space in the
date after a weekday's comma. That comma's space stays breakable, as issue 230 set it. The members list's "Dec 1" holds
too, and a same-month week's name holds its last day to its "and", in the English catalog line.

Emails carry the non-breaking space. A test send through Resend on 2026-11-26 read clean in Gmail on Android; a member
who sees a stray character reports it to the farm. The Spanish catalog stays as it is while translations are on hold.

Search: "date format", "non-breaking", "nbsp", "short month", "formatPickupDate" returned DEC-047, DEC-056 and DEC-057,
which only name Weekly lists among the header's links; new id.
