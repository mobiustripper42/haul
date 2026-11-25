---
schema: 1
id: DEC-054
title: "A member sees a week's menu once the farm assigns it, marked Proposed"
topic: "Product rules"
status: "active"
date: "2026-11-25"
ruling: "A member's Upcoming weeks show a week's menu, their own dishes, from the day the farm assigns it, headed Proposed until its email has gone out (sent_at null). The public page still waits for the email (DEC-036)."
claims:
  - kind: "file"
    target: "app/account/weeks/rows.ts"
    note: "loadWeekMenus: which weeks have a rolldown, and the dishes in each"
  - kind: "file"
    target: "src/menus.ts"
    note: "memberMenuLines: one member's dishes on a menu"
  - kind: "file"
    target: "components/ui/disclosure.tsx"
  - kind: "test"
    target: "app/account/weeks/page.test.ts"
revisit_if: "The farm does not want members to see a menu it may still swap, or a menu is re-sent after a change"
---

## DEC-054: A member sees a week's menu once the farm assigns it

Issue 243 puts each week's menu in its row on Upcoming weeks, so a member sees what they will eat. The farm assigns a
menu some days before it is emailed (DEC-036), and a member about to skip or switch wants it then. The rolldown is there
from the assignment, and its first line says Proposed, since the farm can still swap the menu after members have seen
it. The line ends at the email, not at the week's cutoff, so `week_menus.sent_at` decides it.

DEC-036 stands: the public page shows a menu only once it is emailed. A member's list is for a signed-in member with a
paid subscription, and shows the dishes of that member's own choice only. Searched `grep -rli --exclude-dir=archive
"menu" docs/decisions/`: DEC-036 is the one on when a menu shows; nothing on showing it before the email. See also
DEC-036, DEC-048 (the rolldown is content, not a row's action).
