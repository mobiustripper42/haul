---
schema: 1
id: DEC-036
title: "The weekly menu is published by the daily run"
topic: "Product rules"
status: "active"
date: "2026-11-14"
ruling: "A daily run emails the current week's menu on the configured weekday and stamps the week sent, which is when the public page shows it; the off link is the member id signed under the session secret, with no expiry."
claims:
  - kind: "file"
    target: "src/menu-run.ts"
    note: "runMenuRun: the menu email, the stamp and the missing-menu reminder"
  - kind: "file"
    target: "src/menu-email-link.ts"
    note: "the off link's token"
  - kind: "column"
    target: "week_menus.sent_at"
  - kind: "column"
    target: "members.menu_emails"
  - kind: "env"
    target: "MENU_EMAIL_WEEKDAY"
revisit_if: "The farm wants the menu on the page before it is emailed, a changed menu re-sent, or the off link to expire"
---

## DEC-036: The weekly menu is published by the daily run

One run, `GET /api/menu-run` behind the charge run's bearer, does both jobs, each idempotent by what it leaves behind
(DEC-003). The menu email goes out on the first date after the week's cutoff date whose weekday is `MENU_EMAIL_WEEKDAY`,
once the week holds a menu, to every member with a `paid` or `declined` row for the week (a declined meal is still made,
§7.3) whose preference is on. The menu row is then stamped `sent_at`: the stamp makes the email once and is what the public
page reads, so the page shows a menu from the moment it is emailed. Taking the menu off deletes the row and its stamp, so
a menu put on later is sent again; changing it does not. The admin reminder is an audit event, not a table (DEC-028: an
email went out and no row changed), giving up insert-on-conflict atomicity: two firings in one second could send one
duplicate. The off link is the member id plus a signature of it under the session secret: no column, no expiry. Sign-in
codes, receipts and card notices ignore the preference. See also DEC-003, DEC-028.
