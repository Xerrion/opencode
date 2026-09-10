---
name: jira-story
description: Create, rewrite, or refine a Jira Story or user story for a user or stakeholder outcome. Use when turning a need into a clear goal, value, and testable acceptance criteria without prescribing implementation.
---

# Story

A Story describes what a user or stakeholder needs and why. Do not prescribe implementation. Use a specific persona and a clear value. Acceptance criteria describe observable outcomes, including known failure cases. Use Given/When/Then where useful. Keep technical context in Notes, not in the outcome or acceptance criteria. Mark missing facts as open questions.

## Template

```markdown
As a <user/persona>
I want <goal>
So that <value/outcome>

## Context

<Why is this needed? What problem are we solving?>

## Acceptance Criteria

- <Observable and testable outcome>
- <Observable and testable outcome>
- <Observable and testable outcome>

## Notes

<Relevant constraints, links, designs, dependencies, or technical context>
```
