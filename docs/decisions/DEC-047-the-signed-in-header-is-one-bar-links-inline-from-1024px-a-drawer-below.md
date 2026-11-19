---
schema: 1
id: DEC-047
title: "The signed-in header is one bar: links inline from 1024px, a drawer below"
topic: "Interface"
status: "active"
date: "2026-11-18"
ruling: "The signed-in header is one bar: from 1024px the links and Sign out sit inline in a row wider than the page column, below it in a drawer. The drawer and the Admin group are details elements, plus a small script."
claims:
  - kind: "file"
    target: "app/site-header.tsx"
    note: "the member and admin links, drawn once in the bar and once in the drawer"
  - kind: "file"
    target: "components/ui/menu-script.tsx"
    note: "Escape, backdrop tap, inert; no test, its criterion is by hand"
  - kind: "test"
    target: "app/site-header.test.ts"
revisit_if: "A page needs a header taller than one row, or the drawer must work without details"
---

## DEC-047: The signed-in header is one bar

Members and admins use Haul on desktop and mobile alike, so the header follows muster's admin bar, and `AdminNav`'s
second row of admin links is gone. At 1024px (`lg`) and wider: the wordmark, the member links, for an admin an Admin
group (Members, Menus, Weeks, Weekly lists), then Sign out. Below it: the wordmark and a hamburger opening a drawer
from the right with the same links and Sign out at its foot. No mode switch; each admin page names itself to the
header as `current`.

The row is `max-w-bar` (1152px, a container token) where the page keeps 960px: without it four links, Admin and Sign
out do not fit beside the farm name at 1024px. Only the signed-in header widens.

The drawer and the Admin group are `<details>`, not muster's admin drawer, which is React state and would leave no
links below 1024px with JavaScript off. `MenuScript` adds Escape, a tap on the dimmed page and `inert`, as muster's
crew menu does. Supersedes issue 155's row and Menu, which folded at 720px.
