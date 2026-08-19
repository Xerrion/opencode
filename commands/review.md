---
description: Run code review on files or recent changes
---

Delegate to the `reviewer` agent to perform a code review.

**Scope:** $ARGUMENTS

If no arguments are provided, review staged changes with `git diff --cached`.
If the argument is "recent", review changes since the last commit with `git diff HEAD~1`.
Otherwise, review the specified file(s) or directory.

The reviewer agent will:

- Load `review-philosophy` and `code-philosophy`, plus conditional review skills
- Review correctness, security, performance, maintainability, and project conventions
- Classify issues as BLOCKER, IMPORTANT, or NIT
- Apply the configured confidence floor for each severity tier
- Separate safe refactoring candidates from defects
- Include positive observations and Philosophy Compliance results

Return the complete review findings to the user.
