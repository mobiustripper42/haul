---
schema: 1
id: DEC-039
title: "A token signed under the session secret names its purpose"
topic: "Product rules"
status: "active"
date: "2026-11-15"
ruling: "A token signed under the session secret, other than the session cookie, signs a purpose prefix ending in a colon before its subject, so none made for one purpose passes for another; the off token signs \"menu-emails-off:\" and the member id."
claims:
  - kind: "file"
    target: "src/menu-email-link.ts"
    note: "MENU_EMAIL_TOKEN_PREFIX and menuEmailToken: the first prefixed token"
  - kind: "file"
    target: "src/sign-in/session.ts"
    note: "sign and signatureMatches, shared by the cookie and the prefixed tokens"
  - kind: "test"
    target: "src/menu-email-link.test.ts"
revisit_if: "A token needs an expiry, a second secret is wanted, or a shared tokens module replaces each caller of sign choosing its own prefix"
---

## DEC-039: A token signed under the session secret names its purpose

DEC-036 signs the menu email's off link under the session secret, the secret the session cookie uses. Signed bare, the
member id is a payload any other signature under that secret could be confused with. So a token signs
`<purpose>:<subject>`: the off token signs `menu-emails-off:` and the member id, and `menuEmailToken` is
`sign("menu-emails-off:" + id, secret)`.

The guarantee rests on `:` not being a base64url character. The session cookie signs its payload part, the session encoded as base64url
(`src/sign-in/session.ts`), which can never contain one, so it can never equal a prefixed string. The cookie keeps
signing bare, and gets no prefix. A future token on this secret picks its own prefix, ending in a colon.

An off link emailed before this change stops working: none was sent, there being no host yet. No expiry is added, and
DEC-036's holding stands: signed under the session secret, no column, no expiry.

See also DEC-036.
