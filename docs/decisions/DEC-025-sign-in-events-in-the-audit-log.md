---
schema: 1
id: DEC-025
title: "Sign-in events go in the audit log through audit_event()"
topic: "Data model"
status: "superseded"
date: "2026-11-02"
ruling: "A sign-in by code, a sign-in by link, a lock and an address's first rate-limit refusal in a window each write one audit_log row through audit_event(); a failed write is logged and changes nothing."
claims:
  - kind: "file"
    target: "db/migrations/20261102155411_audit_events.sql"
  - kind: "file"
    target: "app/sign-in/actions.ts"
  - kind: "test"
    target: "db/audit-events.test.ts"
superseded_by: DEC-028
revisit_if: "An attack or a member's question needs an event this does not record, or open question 17 promises erasure"
---

## DEC-025: Sign-in events go in the audit log through audit_event()

An event row has `operation` `'event'` and its name in `audit_log.event`, beside DEC-019's row
changes, so a member's history is one timeline. Rows go in only through `audit_event()`, `security
definer` and hardened as `audit_row()` is: the app's database user needs EXECUTE on it and no insert
right on `audit_log` (granted in task 1.8).

One event per thing that happened once: wrong guesses below the lock, requests, sends and every
refusal after a window's first record nothing. Live state is in `sign_in_codes` and `rate_limit_hits`.

The server actions record events; `src/sign-in/` never knows a member. A failed write is logged
("sign-in event not recorded": event, member id, error name and `code`, never the client address or
message) and changes nothing the member sees, so `audit_log` can have gaps only the server log shows.

See also DEC-022: its `revisit_if` names wrong guesses spread across members, but these events record
a lock, not the guesses below one, so that spread shows only in `sign_in_codes`' live counters. That
miss was accepted on 2026-10-31.
