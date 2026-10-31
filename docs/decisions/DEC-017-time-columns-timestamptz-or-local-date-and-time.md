---
schema: 1
id: DEC-017
title: "A moment is timestamptz; a Cleveland wall-clock time is date and time"
topic: "Data model"
status: "active"
date: "2026-10-28"
ruling: "A column holding a moment is timestamptz. A Cleveland wall-clock time, such as a pickup date or the cutoff, is date and time, read in America/New_York. Neither is ever text or timestamp without time zone."
claims:
  - kind: "spec"
    target: "§7.2"
  - kind: "file"
    target: "db/migrations/20261028120617_sign_in_codes.sql"
  - kind: "unverifiable"
    target: "muster's record 032, vessel-local time"
    note: "the sibling repo keeps times as text"
revisit_if: "The farm runs pickups or cutoffs in a second time zone"
---

## DEC-017: A moment is timestamptz; a Cleveland wall-clock time is date and time

Comparisons on time run in SQL — a sweep of expired rows, a 24-hour window — and `timestamptz`
compares instants, where text compares letters and is right only while every value is written in
exactly one format. Postgres also refuses a value that isn't a time, and `pg` hands the code a
`Date`, as `members.created_at` already does.

Muster stores times as text strings and guards every write with a format check; its record 032
declined to change for the migration it would take. Code ported from muster brings the habit with it, which is
why this is written down. Pickup windows and the cutoff are Cleveland wall-clock times, not
instants, and stay `date` and `time` (`docs/SPEC.md` §7.2).

Enforced by the schema check in `db/schema-check.ts`, added by task 0.8 (issue #11).
