---
schema: 1
id: DEC-016
title: "Members sign in by an emailed 6-digit code into a 30-day signed cookie"
topic: "Stack & hosting"
status: "active"
date: "2026-10-28"
ruling: "Sign-in is muster's emailed 6-digit code: 10 minutes, 5 guesses a code, 50 wrong a day per member, 20 requests an hour per address. The session is a signed 30-day cookie that neither slides nor revokes."
claims:
  - kind: "spec"
    target: "§7.9"
  - kind: "file"
    target: "src/sign-in/code.ts"
  - kind: "file"
    target: "src/sign-in/session.ts"
  - kind: "file"
    target: "eslint.config.mjs"
revisit_if: "A member can do something a stolen session must be cut off from, or sailbook's sign-in turns src/sign-in/ into a shared library"
---

## DEC-016: Members sign in by an emailed 6-digit code into a 30-day signed cookie

Ported from muster, whose records 081, 142 and 189 (in the sibling repo) hold the reasoning for the
code, the per-member failure window and the per-address limit. Every failed guess gives the same
answer, and an email with no member gets the same screens and no email, so nothing tells a stranger
which addresses have accounts. The limiter fails open: the code caps still guard verify.

The session is stateless: a token signed with the server's secret, no session table. Sign-out clears the cookie; only
rotating `SESSION_SECRET` ends every session. Thirty days absolute, not muster's 14 sliding: crew
work often and must not sign in again, members visit weekly at most (Eric, 2026-10-27). Revoking one
member's session rides along with admin revoke.

`src/sign-in/` knows a subject only as `{ id, email }` and imports nothing else of haul's, enforced
by lint. Muster, bushel and haul each hold a copy of this flow; the shared library is built when
sailbook needs sign-in, from this folder.
