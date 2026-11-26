---
schema: 1
id: DEC-056
title: "An admin sees one interface at a time; the page picks it and a switch crosses"
topic: "Interface"
status: "active"
date: "2026-11-25"
ruling: "The header holds the Admin interface's links or the Member interface's, never both: an admin on a page with an admin- mark sees the first, anywhere else the second, with a switch to the other beside Sign out. Nothing is stored."
claims:
  - kind: "file"
    target: "app/site-header.tsx"
    note: "adminInterface: the admin role and an admin- mark pick the links, the switch and the farm's name's destination"
  - kind: "file"
    target: "app/sign-in/shared.ts"
    note: "finishSignIn: an admin lands on the flow's adminDone, which only the Sign in page's flow has"
  - kind: "test"
    target: "app/site-header.test.ts"
supersedes:
  - DEC-047
revisit_if: "An admin page cannot give the header its mark, or the farm wants the interface to persist across pages"
---

## DEC-056: An admin sees one interface at a time

DEC-047 gave an admin one bar holding the member links and an Admin group together, and ruled "No mode switch". This
replaces that part; its bar, drawer and 1024px fold stand.

On a page whose header carries an `admin-` mark an admin sees Members, Menus, Weeks and Weekly lists, then a switch to
Your account, then Sign out. On every other page, the menu, the legal pages and Your account included, they see the
member links, then a switch to Admin, then Sign out. The farm's name goes to the admin's page in the first and to `/` in
the second. Below 1024px the drawer holds the same, the switch directly above Sign out. A member who is not an admin
sees today's header everywhere. Nothing is stored: the page decides, by the mark every admin page already gives.

An admin signing in on the Sign in page lands on the admin's page; elsewhere, where a member does.

Searched "header" (DEC-043, 047, 048, 050, 055) and "Admin group" (DEC-047 alone): supersedes DEC-047.
