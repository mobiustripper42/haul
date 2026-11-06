-- 20261106200318_drop_audit_event_names_check.sql — drop_audit_event_names_check
-- Applied in filename order by db/migrate.ts (DEC-013).

-- The event names were listed twice: in this check and in AUDIT_EVENT_KINDS (src/ports/repository.ts), and
-- every new event cost a migration to widen the check. The type holds the list now: a name outside
-- AUDIT_EVENT_KINDS is refused by the compiler. audit_log_event_named_check stays (an event row has a
-- name and a row change does not), and audit_event() stays the only way in (DEC-019, DEC-028).
alter table audit_log drop constraint audit_log_event_known_check;
