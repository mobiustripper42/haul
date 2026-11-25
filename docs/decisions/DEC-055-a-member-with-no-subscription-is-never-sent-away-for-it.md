---
schema: 1
id: DEC-055
title: "A signed-in member is never sent to another page for lacking a subscription"
topic: "Interface"
status: "active"
date: "2026-11-25"
ruling: "A signed-in member without an active subscription, never joined or cancelled, stays on the page they asked for, which says so in place with a way to join. Only a signed-out visitor is redirected."
claims:
  - kind: "file"
    target: "app/account/subscriber.ts"
    note: "requireAccount: the member, the Supper Club and a subscription or null"
  - kind: "file"
    target: "app/account/no-supper-club-notice.tsx"
  - kind: "file"
    target: "app/site-header.tsx"
    note: "the Supper Club and This week's menu links"
  - kind: "test"
    target: "app/account/subscriber.test.ts"
revisit_if: "A member page has nothing it can show a member with no subscription, or the farm sells a second product"
---

## DEC-055: A signed-in member is never sent to another page for lacking a subscription

Until issue 260, `requireSubscriber` sent a member with no subscription to `/supper-club`, and a cancelled one off Update
your card and Cancel the Supper Club. Someone who signed in to see their details landed on a join page.

Now `requireAccount` returns the subscription or null, so each caller handles a member with none: Your account holds a
Notice with a way to join, Upcoming weeks and History hold no rows, the card and cancel pages hold the back link, their
heading and that Notice, and the account actions write nothing. The header adds Supper Club and This week's menu.

Still redirected: a signed-out visitor, an active member on `/supper-club`, and a member with none on `/supper-club/done`
and `/supper-club/already`.

Searched `grep -rli --exclude-dir=archive` for "redirect", "sent to", "no subscription", "requireSubscriber": nothing; new
id. See also DEC-018, DEC-047.
