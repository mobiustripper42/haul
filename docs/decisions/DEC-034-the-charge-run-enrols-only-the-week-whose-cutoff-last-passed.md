---
schema: 1
id: DEC-034
title: "The charge run enrols only the week whose cutoff last passed"
topic: "Payments"
status: "draft"
date: "2026-11-13"
ruling: "Each firing enrols only the latest week whose cutoff has passed, so a week no firing reached is never charged late. A closed week is never charged: its rows are looked up, then deleted after its pickup. A stranded signup is only looked up."
claims:
  - kind: "spec"
    target: "§7.3"
  - kind: "spec"
    target: "§7.10"
revisit_if: "A week is lost because no firing reached it, or the farm wants a missed week charged after its pickup"
---

## DEC-034: The charge run enrols only the week whose cutoff last passed

A week stops being the latest only once its pickup is over (a move ends by the next cutoff), so a
week the run never reached had no rows, no pick list and no meals; charging it later charges for
nothing. Due is read as of the cutoff: a cancel after it still pays that week (§7.2, "all changes
key off" the cutoff). A row the run enrolled was made whatever happened to its charge (DEC-004), so
it settles whenever an answer comes — unless its week closed first, since a closed week had no meals: then the run
only looks for a payment an earlier attempt took, and removes the row once the week's pickup is over. A stranded signup was never due, so the run confirms what
Square took and leaves the rest to the member's "Try again". A missed week is caught by the health
endpoint's last charge run (DEC-003's body), which 2.11 records. See also DEC-003.
