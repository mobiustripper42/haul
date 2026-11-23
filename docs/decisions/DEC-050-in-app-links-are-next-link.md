---
schema: 1
id: DEC-050
title: "In-app links are next/link, drawn only in components/ui/"
topic: "Interface"
status: "active"
date: "2026-11-22"
ruling: "Every in-app link is a next/link, so a tap swaps the page body instead of reloading the page. Button, TextLink and Wordmark draw them; lint refuses a raw a element or a next/link import elsewhere."
claims:
  - kind: "file"
    target: "components/ui/in-app-href.ts"
    note: "the one rule for which href is in-app: safeReturnTo returns it unchanged"
  - kind: "file"
    target: "components/ui/menu-script.tsx"
    note: "a menu link to the page already showing closes its menu at once; any other closes the menus once the address has changed and the page has redrawn"
  - kind: "test"
    target: "app/ui-lint.test.ts"
  - kind: "test"
    target: "components/ui/in-app-href.test.ts"
revisit_if: "A page needs a link that must reload the whole page, or Next's client navigation stops fitting the header's menus"
---

## DEC-050: In-app links are next/link

A tap on an in-app link used to reload the whole page. Now it loads only the new page's body. The change lives inside
`Button`'s link form and `TextLink`, so no screen's code changes, and the header's wordmark moves into `Wordmark`.
Follows DEC-024 (one component per look): the link logic lives only in `components/ui/`, enforced by lint, which
refuses a raw `<a>` and an import of `next/link` outside it.

An `href` is in-app when `safeReturnTo` returns it unchanged. Anything else (`mailto:`, `tel:`, `http:`, `https:`,
`//…`, `#…`), a `TextLink` with `newTab`, and a `Button` link given `download` stay a plain `<a>`: a download is named,
not guessed from the path.

The header's menus are `<details>` that used to close because every tap reloaded the page (DEC-047). Each page draws
its own header, so a navigation to another path usually mounts a fresh one with its menus closed, but a query-only
step (a row's Note on `/admin/weeks`) keeps the header and a row's More mounted. So `MenuScript` closes a menu at once
for a link to the page already showing, where nothing will arrive, and for any other menu link closes the menus on the
first change to the page after the address has changed: the new page, not the tap, so a tapped link stays visible
while its page loads.
