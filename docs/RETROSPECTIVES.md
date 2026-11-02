# Haul — Phase Retrospectives

Written by `/retro` at each phase boundary, newest first. Each entry fits on one screen.

---

## Phase 0 — 2026-11-02

**Numbers:** 67 / 27 pts · 7.6 days · 3 re-estimated, drift +8 · 22 PRs

**What happened:** Phase 0 shipped the foundation: skeleton, Postgres and CI, i18n, email-code sign-in with a lock, an emailed link and audit events, the admin guard and audit by trigger. Seven tasks were added mid-phase, including Playwright and UI consistency; 0.5 folded into 0.6 and the migration checksum was cut, then reopened for Phase 1. `/build-task` was built alongside.

**Operator:** For a brand new project I think this went exceeding well. We also refined new workflow and I think added UI consistent I'll be able use in future projects too. Scope was maintained, only added when required. I can't think of an improvement right this second

**PM read:** Scope held only in the sense that each addition was argued. Adding 34 points to a 27-point plan means the original plan covered about 40% of what the phase did, so weigh that before the next estimate. "I can't think of an improvement right this second" overlooks one miss on record. Issue #30, the migration checksum, was cut. Then 0.13, the first `/build-task` run with a migration, recorded an empty stub as applied. The stub came from the Lead's own prompt to @test-writer. The checksum would have caught it. Next phase, give any cut that guards the workflow's own tooling a written reopen trigger.

**Unpointed:** issue #8 (0.5, folded into 0.6 and closed as not planned)

**UI review:** 0 fixed before close, 9 filed for Phase 1 (issues #43–#51)
