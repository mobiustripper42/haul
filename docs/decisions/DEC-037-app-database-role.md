---
schema: 1
id: DEC-037
title: "The app connects as haul_app, which cannot rewrite the audit log or truncate"
topic: "Data model"
status: "active"
date: "2026-11-14"
ruling: "The app runs as the database role haul_app: read and write on the business tables, read only on audit_log, nothing on _migrations, no truncate, no schema change; the schema check fails the build if that drifts."
claims:
  - kind: "file"
    target: "db/migrations/20261115001527_app_role.sql"
  - kind: "file"
    target: "db/schema-check.ts"
  - kind: "file"
    target: "src/adapters/pg-connect.ts"
  - kind: "test"
    target: "db/app-role.test.ts"
revisit_if: "A table needs rights other than the four, a second app role is wanted, or migrations stop running as one user"
---

## DEC-037: The app connects as haul_app, which cannot rewrite the audit log or truncate

This makes true what DEC-019 promised (no insert on `audit_log`, no `TRUNCATE`) and what DEC-025 did
and DEC-028 dropped (EXECUTE on `audit_event()`).

One migration creates `haul_app` if absent, `NOLOGIN`, and leaves a hand-made one's login alone:
production creates the user, then migrates. It grants the four (`select`, `insert`, `update`, `delete`) on every
table, `select` only on `audit_log`, nothing on `_migrations`, EXECUTE on `audit_event()`. Later tables
and sequences get the four and `usage` by default privileges, which bind to the migrating user: **every
migration must run as that same user.**

`APP_RIGHTS_EXCEPTIONS` in `db/schema-check.ts` lists tables whose rights differ, apart from
`AUDIT_EXEMPT`. `schemaViolations` fails the build on drifted rights, anything `public` holds, a haul_app
with powers or objects, or missing defaults. `asAppRole(url)` adds `options=-c role=haul_app`.

See also DEC-019, DEC-028. The role's production login and the `--no-acl` dump caveat are task 1.8's.
