---
name: jira-sub-task
description: Create, rewrite, or refine a Jira Sub-task or subtask for a small implementation step belonging to a parent issue. Use when splitting parent work into specific steps. Keep the Sub-task tiny and never copy the parent's context, description, or acceptance criteria.
---

# Sub-task

A Sub-task is a small implementation step belonging to a parent issue. Ask for the parent if none is identified. Reference its key or link when available; never invent one.

Never copy the parent's context, description, or acceptance criteria, even in Notes. The parent remains the source for that information. When rewriting a Sub-task, remove repeated parent content from the draft. Keep only the specific work, a small Done When list, optional notes, and the parent reference. Done When checks only this step, not the whole parent's outcome.

## Template

Omit Notes if not needed.

```markdown
<Specific piece of implementation work>

## Done When

- <Completion condition>

## Notes

<Only if needed>
```
