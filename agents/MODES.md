# Tech-Lead Modes

This file documents two alternative configurations for the `tech-lead` agent. Only ONE is active at a time; the agent file `agents/tech-lead.md` is whatever the active mode says it is.

## Why two modes exist

`tech-lead` is the easiest agent in the fleet to over-invoke. Anything that smells like "design" can be funnelled to it, which both wastes cycles and infantilises `software-engineer`. Two parked configurations exist so the fleet can be tuned without re-deriving the agent from scratch each time:

- **Mode A (live, raised bar).** `tech-lead` is a high-bar specialist. Most design lands on `software-engineer` in-flight; the architect is invoked for genuinely structural calls.
- **Mode B (ghost, near-vestigial).** `tech-lead` is near-eliminated. Almost all design lands on `software-engineer` in-flight; the architect exists only for greenfield work and explicit ADR requests.

The choice between them is a posture call, not a correctness call. Start with Mode A; swap to Mode B if `tech-lead` is still over-fired.

## Mode A - live (current default)

**File:** `agents/tech-lead.md`

**Invoke `tech-lead` ONLY when ONE of:**

1. A new module, service, or subsystem is being introduced that does not yet exist in the codebase.
2. A change touches 3+ subsystems and the dependency direction or contract shape is genuinely non-obvious (not just "spans multiple files").
3. The user explicitly asks for the design up front (e.g., an ADR).

Otherwise, `software-engineer` designs in-flight; `reviewer` catches architectural BLOCKERs.

Research and review agents (`explore`, `researcher`, `wow-addon`, `reviewer`, `red-team`) return findings. They do NOT auto-funnel design questions to `tech-lead` - the orchestrator decides whether the three-clause bar is met.

## Mode B - ghost (parked alternative)

**File:** `agents/tech-lead.ghost.md.parked` (currently dormant). opencode's agent loader keys on the `.md` extension, so the `.parked` suffix is what keeps this file inert; the in-prose `<dormant>` banner is documentation only and does not prevent auto-registration.

**Invoke `tech-lead` ONLY when ONE of:**

1. Greenfield system design - no existing codebase context, or a net-new service being built from scratch.
2. The user explicitly requests an ADR by name.

All in-codebase architecture decisions go to `software-engineer`; `reviewer` catches architectural BLOCKERs. There is no third trigger; cross-subsystem complexity inside an existing codebase is engineer's call.

## Swap procedure

Filenames are what `build`/`plan` resolve, so swapping is a rename dance with no configuration edits required:

1. `git mv agents/tech-lead.md agents/tech-lead.live.md` (backup the current live config under a non-conflicting name).
2. `git mv agents/tech-lead.ghost.md.parked agents/tech-lead.md` (promote ghost to active; dropping the `.parked` suffix is what makes opencode pick it up).
3. Open the new `agents/tech-lead.md` and delete the `<dormant>` banner block at the top.
4. To swap back: reverse the renames (re-add the `.parked` suffix to the parked file) and re-add the `<dormant>` banner to it.

`opencode.jsonc`, slash commands, and any agent registry pointers reference the agent by basename (`tech-lead`), so they need no change.

## What changes for callers when swapped to Mode B

If Mode B is activated, the rest of the fleet must adjust:

- **`build.md` routing.** Drop the three-clause bar from the routing rule and the matrix; replace with "route to `tech-lead` only for greenfield system design or user-requested ADRs; all in-codebase architecture defaults to `software-engineer` with `reviewer` catching BLOCKERs."
- **`plan.md` workflow.** Step 1 should stop offering `tech-lead` as a research delegation entirely except when the user asked for an ADR by name. The plan describes the design inline; the engineer implements.
- **Research and review agents** (`explore`, `researcher`, `wow-addon`, `reviewer`, `red-team`, `servicenow`, `servicenow-dev`). Stop redirecting design questions to `tech-lead` outright. Findings flow back to the orchestrator; default routing is `software-engineer` in-flight.
- **Orchestrator (`build`) must accept** that complex in-codebase design lands on `software-engineer` + `reviewer` alone. The mandatory review loop becomes the only architectural safety net for in-codebase work. If `reviewer` finds an architectural BLOCKER, it goes back to `software-engineer` to redesign in-flight, not to `tech-lead`.

A swap to Mode B is a deliberate posture change. Make it only after observing that Mode A still over-funnels to `tech-lead` in practice.
