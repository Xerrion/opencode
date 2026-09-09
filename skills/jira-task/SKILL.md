---
name: jira-task
description: Create, rewrite, or refine a Jira Task for technical work with a concrete deliverable, such as maintenance, configuration, or technical debt. Use for standalone technical work rather than a user Story or a parent-bound Sub-task. For investigations stored as Tasks, use jira-spike.
---

# Task

A Task describes technical work with a concrete deliverable. State why it is needed, what will be delivered, and how completion can be checked. Do not invent a user story for technical work. Mark missing facts as open questions. Omit Notes if not needed. For a Task whose purpose is investigation, use `jira-spike` instead.

## Template

```markdown
# Task

## Purpose
<Why is this technical work needed?>

## Deliverable
<Concrete artifact or technical change to deliver>

## Done When
- [ ] <Verifiable completion condition>

## Notes
<Only relevant constraints, dependencies, or links>
```
