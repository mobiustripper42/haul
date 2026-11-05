---
schema: 1
id: DEC-029
title: "An account is a member row whose email a sign-in code confirms"
topic: "Product rules"
status: "active"
date: "2026-11-04"
ruling: "An account is a member row whose email a sign-in code confirms: created unconfirmed, marked confirmed by the first code or link redeemed; unconfirmed rows are deleted by hand, not by the app."
claims:
  - kind: "spec"
    target: "§6.1"
  - kind: "column"
    target: "members.email_confirmed_at"
  - kind: "file"
    target: "db/migrations/20261104230355_member_account.sql"
  - kind: "file"
    target: "src/create-account.ts"
  - kind: "test"
    target: "src/create-account.test.ts"
revisit_if: "Unconfirmed rows are created faster than a person would delete them"
amends_spec:
  - section: "6.1"
    scope: "a visitor creates an account, confirmed by an emailed code, before subscribing; the Supper Club page shows its choices to anyone"
---

## DEC-029: An account is a member row whose email a sign-in code confirms

Eric, 2026-11-04: account first, then subscribe. Create Account writes the member row at once, with
`email_confirmed_at` null, and emails a sign-in code. The first code or link redeemed through
sign-in's own flow (DEC-016, DEC-022) sets `email_confirmed_at`, so the lock, the resend wait and
the expiry are unchanged and there is one way in.

The row exists before the email is confirmed, so every reader of `members` from here on decides what
an unconfirmed row means. Details for an email whose member is confirmed change nothing, and the
response is the same for a new, an unconfirmed and a confirmed email, so it tells nobody which
emails are members.

Nothing deletes an unconfirmed row. By hand: `email_confirmed_at` is null and the member has no
`sign_in_codes` row created in the last 24 hours (the code row, not `members.created_at`, so a lock
is never reset).

See also DEC-016 (sign-in by emailed code) and DEC-026 (its question about an email that already
holds a subscription moves to task 1.4).
