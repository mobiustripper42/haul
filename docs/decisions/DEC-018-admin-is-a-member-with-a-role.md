---
schema: 1
id: DEC-018
title: "An admin is a member with the role admin, checked on each admin page"
topic: "Data model"
status: "active"
date: "2026-10-30"
ruling: "An admin is a member whose single role is admin, in a checked column. requireAdmin() runs first on every admin page and action; no check lives in a layout."
claims:
  - kind: "spec"
    target: "§5"
  - kind: "column"
    target: "members.role"
  - kind: "file"
    target: "db/migrations/20261030043016_member_role.sql"
  - kind: "file"
    target: "app/session.ts"
revisit_if: "A person needs two roles at once, or a role must see pages an admin does not"
---

## DEC-018: An admin is a member with the role admin, checked on each admin page

`members.role` is `text not null default 'member'` with a check listing `ROLES` (`src/members.ts`),
the way `language` is. One role per member covers member, admin and any later role nobody holds
alongside another; a person who needs two at once costs a migration to a join table. `docs/SPEC.md`
§5 asks for "a role, not a flag", and this is that.

`requireAdmin()` reads the member through `getSignedInMember`, so the role comes from the database on
every load: a demoted admin loses access on the next click though the 30-day cookie stays valid
(DEC-016). It is called first by each admin page and each admin server action. A layout check would
not cover a server action, and a page that forgot it would look guarded; checking in the page makes
the omission visible in that page's own file.

Roles are granted by SQL and seeds (DEC-007), not from a screen.
