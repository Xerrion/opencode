---
name: jira-bug
description: Create, rewrite, or refine a Jira Bug when existing behavior differs from expected behavior. Use for defect reports that need environment details, reproduction steps, actual and expected results, impact, and evidence.
---

# Bug

A Bug describes existing behavior that differs from expected behavior. Separate observed facts from suspected causes. Make reproduction steps clear. Record unknown details as questions; do not invent reproduction steps or evidence. Omit browser or device fields only when they do not apply. Do not include secrets or personal data in evidence.

## Template

```markdown
<Short description of the problem>

## Environment

- Environment: <Production / Test / Development>
- Version/build: <Version>
- Browser/client: <If relevant>
- OS/device: <If relevant>

## Steps to Reproduce

1. <Step>
2. <Step>
3. <Step>

## Actual Result

<What happens?>

## Expected Result

<What should happen?>

## Impact

<Who or what is affected, and how severely?>

## Evidence

<Screenshots, logs, request IDs, traces, or links>
```
