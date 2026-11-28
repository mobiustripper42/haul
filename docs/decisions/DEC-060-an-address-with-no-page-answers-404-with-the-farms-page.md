---
schema: 1
id: DEC-060
title: "An address with no page answers 404 with the farm's page, never a redirect"
topic: "Interface"
status: "active"
date: "2026-11-27"
ruling: "An address with no page, and a page that finds nothing, answers 404 with the farm's Not Found page: the site header, one line, and a link to Your account when signed in or the Supper Club otherwise. A wrong address is never redirected."
claims:
  - kind: "file"
    target: "app/not-found.tsx"
    note: "the root not-found page, the Member header for everyone"
  - kind: "file"
    target: "app/home-path.ts"
    note: "where the link onward goes, the same rule as /"
  - kind: "test"
    target: "app/not-found.test.ts"
  - kind: "test"
    target: "e2e/not-found.spec.ts"
revisit_if: "Admins land on missing /admin addresses often enough that the Member header gets in the way, or an app/error.tsx is added"
---

## DEC-060: An address with no page answers 404 with the farm's page, never a redirect

Nobody can stop a wrong address from being reached: a typo like `/menuK`, an old bookmark. Next's built-in 404 page is
black, with no header and no way back, so the fix is a page in the farm's look (issue 271). A redirect to the home page
would hide real broken links, so the status stays 404 and nothing redirects.

The page shows the Member header to everyone, an admin included: reading the address to pick the interface costs more
than a few wrong admin addresses a year earn, and the header's switch is one tap from Admin. Its link onward is `/`'s
rule, held once in `homePath()`.

The menu email's off link is a route handler, where Next answers `notFound()` with an empty 404 and draws no page; a bad
off link stays that way, and the member replies to the email to reach the farm (Eric, 2026-11-27).

Searched `grep -rli --exclude-dir=archive` for "not found|404|not-found": DEC-012, DEC-021, DEC-023 and DEC-028, none
about a page for a wrong address; new id.
