---
schema: 1
id: DEC-013
title: "Migrations are plain SQL files, named by UTC timestamp, forward only"
topic: "Data model"
status: "active"
date: "2026-10-26"
ruling: "Schema changes are plain SQL files named by UTC timestamp, applied in order and recorded in _migrations with a checksum. A migration is editable until its pull request merges, never after; an applied file that changed is refused, not rerun."
claims:
  - kind: "file"
    target: "db/migrate.ts"
  - kind: "file"
    target: "db/new-migration.ts"
  - kind: "file"
    target: "db/rebuild.ts"
  - kind: "script"
    target: "db:new-migration"
  - kind: "script"
    target: "db:rebuild:dev"
revisit_if: "A migration needs to run outside a transaction, or two branches keep colliding on one table"
---

## DEC-013: Migrations are plain SQL files, named by UTC timestamp, forward only

Muster's runner and naming (`muster/db/migrate.ts`, `muster/db/new-migration.ts`, and its record
121, in the sibling repo, which cites the collision that forced timestamps). Each file runs in its
own transaction and is recorded in `_migrations`; a second run applies nothing. `npm run
db:new-migration <name>` makes the file, so a stamp is never hand-typed. No down migrations.

A migration may be edited until the pull request that adds it merges, and never after. Each
`_migrations` row carries a checksum of its file; `migrate` refuses, applying nothing, when an
applied file has changed, has no checksum on record or is gone, and never reruns it. A local
database is rebuilt from empty with `npm run db:rebuild:dev` (`db/rebuild.ts`, local hosts only);
test databases rebuild themselves on that refusal. After a merge a mistake is fixed by the next
file. Rewritten in place on 2026-11-02 rather than superseded, a knowing break of DEC-J020
(issue 30).
