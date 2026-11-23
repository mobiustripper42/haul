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
    note: "a menu link to the page showing closes its menu at once; any other closes the menus once the address changes"
  - kind: "test"
    target: "app/ui-lint.test.ts"
  - kind: "test"
    target: "components/ui/in-app-href.test.ts"
revisit_if: "A page needs a link that must reload the whole page, or Next's client navigation stops fitting the header's menus"
---

## DEC-050: In-app links are next/link

A tap on an in-app link used to reload the whole page; now it loads only the new page's body. `Button`'s link form,
`TextLink` and `Wordmark` draw the links, so no screen changes; per DEC-024, lint refuses a raw `<a>` or a `next/link`
import outside `components/ui/`.

An `href` is in-app when `safeReturnTo` returns it unchanged. Any other, a `TextLink` with `newTab`, and a `Button`
given `download` stay a plain `<a>`: a download is named, not guessed from the path.

The header's menus used to close because every tap reloaded the page (DEC-047). A query-only step (a row's Note on
`/admin/weeks`) keeps them mounted, so `MenuScript` closes a menu at once for a link to the page showing, and for any
other closes the menus once the address has changed and the page redrawn: the tapped link stays visible meanwhile.
