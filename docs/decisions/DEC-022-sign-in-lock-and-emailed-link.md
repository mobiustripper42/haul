---
schema: 1
id: DEC-022
title: "Five wrong codes lock sign-in by code; an emailed link signs the member in"
topic: "Stack & hosting"
status: "active"
date: "2026-10-31"
ruling: "Sign-in is an emailed 6-digit code; 5 wrong guesses in a member's 24-hour window lock it, and the member signs in with a single-use emailed link instead. One sign-in email per member per 10 minutes."
claims:
  - kind: "file"
    target: "src/sign-in/code.ts"
  - kind: "file"
    target: "src/sign-in/session.ts"
  - kind: "file"
    target: "eslint.config.mjs"
  - kind: "file"
    target: "app/sign-in/actions.ts"
supersedes:
  - DEC-016
revisit_if: "A member is locked out and the link doesn't reach them; sign-in events (task 0.13) show wrong guesses spread across members; or a stolen session must be cut off"
amends_spec:
  - section: "7.9"
    scope: "five wrong guesses in a member's day lock code sign-in and email a single-use sign-in link"
  - section: "7.12"
    scope: "sign-in codes and links always send, at most one per member every 10 minutes, the locking link excepted"
---

## DEC-022: Five wrong codes lock sign-in by code; an emailed link signs the member in

Sign-in is the emailed 6-digit code: 10 minutes, 5 guesses a code. Five wrong guesses in a member's
fixed 24-hour window lock code sign-in, the right code included. The guess that locks, and any
request while locked, emails a single-use 10-minute link to a one-button page; opening the page
spends nothing, the button does, and it clears the lock. Admins share all of this.

A member gets one sign-in email per 10 minutes, held in the write itself so requests that arrive
together send one; the locking guess's link is the exception. Requests are limited to 20 an hour per
address, failing open. Every failure gives the one answer, and an email with no member gets the same
screens and no email.

The session is a signed 30-day cookie that neither slides nor revokes. `src/sign-in/` imports nothing
else of haul's, enforced by lint.
