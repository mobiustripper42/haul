# Haul — Decisions

Decisions about Haul, each with an id (`DEC-###`). Ids are burned and never reused.

**Every record is schema v1** and the corpus started on 2026-10-25, so there are no frozen
records. `ruling` is the one line a person reads; `claims` say what the record asserts about the
spec or the tree; the body stays under 2000 bytes.

**One decision, one file**, at `docs/decisions/DEC-###-<slug>.md`. This index is generated: edit a
record and run `npm run gen:decisions`. `npm run check:decisions` fails the build on a stale index.

**A change of mind is a new record**, carrying `supersedes: [DEC-###]`; the old record flips to
`status: superseded` with `superseded_by`. Records that merely relate name each other in plain
**see also** prose.

Muster decisions are cited by number only ("muster's record 020"), never by id, because they live
in the sibling repo and are background, not rulings for Haul.
