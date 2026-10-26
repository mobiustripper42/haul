---
schema: 1
id: DEC-013
title: "Migrations are plain SQL files, named by UTC timestamp, forward only"
topic: "Data model"
status: "active"
date: "2026-10-26"
ruling: "Schema changes are plain SQL files named by UTC timestamp, applied in filename order by db/migrate.ts, recorded in _migrations, and never edited or reversed once applied."
claims:
  - kind: "file"
    target: "db/migrate.ts"
  - kind: "file"
    target: "db/new-migration.ts"
  - kind: "script"
    target: "db:new-migration"
revisit_if: "A migration needs to run outside a transaction, or two branches keep colliding on one table"
---

## DEC-013: Migrations are plain SQL files, named by UTC timestamp, forward only

Muster's runner and naming (`muster/db/migrate.ts`, `muster/db/new-migration.ts`, and its record
121, in the sibling repo, which cites the collision that forced timestamps). Each file runs in its
own transaction and is recorded in `_migrations`; a second run applies nothing. `npm run
db:new-migration <name>` makes the file, so a stamp is never hand-typed. No down migrations: a
mistake is fixed by the next file, and an applied file is never edited (DEC-007).
