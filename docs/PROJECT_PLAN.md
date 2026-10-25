# [Project Name] — Project Plan

**Start date:** [YYYY-MM-DD]
**Target:** TBD — a date, if there is one
**Critical path:** [What must be true before this is useful to anyone]

---

## Estimation Method

Fibonacci scale (2, 3, 5, 8, 13). See `VELOCITY_AND_POKER_GUIDE.md` for definitions.
All estimates from planning poker between [your name] and Claude.
Disagreements logged in the Standing Disagreements table at the bottom.
Tests are baked into every task estimate — no separate testing tasks.

---

## Phase 0: Infrastructure

Before any feature work: get the environment, the test harness and the docs to a state where every
later session is faster and safer. No user-facing value ships in this phase.

**The rows below are questions, not a checklist.** Every project answers them differently — a
webapp stands up a local database and a browser runner, firmware needs a bench node and a way to
read packets off it, a library needs neither. Delete rows that do not apply and add the ones this
stack needs. Points are yours to set.

| # | Task | Points | Notes |
|---|------|--------|-------|
| 0.1 | Local environment runs the thing | [N] | [what "runs" means here] |
| 0.2 | Data layer, if there is one — schema under migrations, seed data for tests | [N] | Delete if no database |
| 0.3 | Test harness installed and one real test passing | [N] | The `Proof` slot in `.claude/CLAUDE-context.md` names what a check is here |
| 0.4 | The gate runs end to end and is green | [N] | One command. `/kill-this` runs it before every commit |
| 0.5 | Security-shaped tests for whatever guards access | [N] | Delete if nothing guards access |
| 0.6 | `@ui-reviewer` spec + `.claude/ui-context.md`, if there is a UI | [N] | Delete for a project with no surface |
| 0.7 | Session skills present in `.claude/skills/` | 1 | Installed with the rest of jig |
| 0.8 | `CLAUDE.md`, `.claude/CLAUDE-context.md`, `docs/SPEC.md`, `docs/decisions/` filled in | [N] | Before the first working session if possible |

**Phase 0 total: [sum] pts**

**Ejection point:** the environment is trustworthy. Nothing user-facing exists yet.

**Demo:** the gate, green, from a clean checkout.

---

## Phase 1: [Name]

[Description of what this phase delivers and why it comes first]

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 1.1 | [Task name] | [N] | |
| 1.2 | [Task name] | [N] | |

**Phase 1 total: [sum] pts**

**Ejection point:** [What's working / what can be demoed at end of this phase]

---

## Phase 2: [Name]

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 2.1 | [Task name] | [N] | |

**Phase 2 total: [sum] pts**

---

## Phases

One row per phase, written by `/retro` at close.

| Phase | Closed | Points | Days | Re-estimated | Net drift |
|-------|--------|--------|------|--------------|-----------|
| 0 | — | — | — | — | — |
| 1 | — | — | — | — | — |

**Points** is done / planned. **Net drift** is final points minus original estimates; positive means tasks ran bigger than pointed.

---

## Estimation Poker — Standing Disagreements

Unresolved estimate disagreements. Revisit when the task starts.

| Task | Claude says | You say | Question |
|------|------------|---------|----------|
| [task] | [N] | [N] | [what's in dispute] |

---

## Phase Boundary Checklist

At the end of every phase:
1. The gate is green — the one command `/kill-this` runs before every commit
2. Every check the `Proof` slot names for this project passes
3. Run `/retro` — it writes the retrospective entry in `docs/RETROSPECTIVES.md` and the phase row above
4. Return to primary planning chat — review docs against intent

---

## Cuttable Tasks (if behind)

Tasks that can move to a later phase, or out of scope, without breaking core functionality. Reference before any scope cut conversation.

| Task | Why it's cuttable | Move to |
|------|------------------|---------|
| [task ID] | [reason] | Phase [N], or out of scope |
