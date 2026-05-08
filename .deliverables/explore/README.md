# Explore Deliverables

Durable read-only inventories produced by the `explore` agent. Each file in this directory captures the findings from one scoped scout - a multi-file inventory or audit too large to live in a chat response - so the orchestrator and downstream agents can consume the report without re-running the search.

## Filename convention

```
YYYY-MM-DD-slug.md
```

- `YYYY-MM-DD` is the ISO date the scout was run.
- `slug` is kebab-case, derived from the scope of the scout, ~6 words max.
- Example: `2026-05-08-stale-tool-references.md`.
- On same-day collisions, append `-2`, `-3`, etc. The `explore` agent lists this directory before writing to detect collisions.

## Lifecycle

Scout reports are point-in-time snapshots, not living documents. The codebase moves on; an old report describes the codebase as it was when the scout ran. Old files are kept on disk for historical reference and are not pruned.

## Edit policy

- Typo and clarity edits are allowed in place, no ceremony.
- New material that arrives from a re-scout is NOT merged into an existing file - it goes into a NEW dated file. Editing an old report retroactively erases the snapshot.
- Decision changes do not apply here - scouts are findings, not decisions. If a finding is contradicted by later work, write a new dated scout.

## Authorship

Only the `explore` agent should add files here. Engineers and other agents consume these documents; they do not edit them as part of implementation work.
