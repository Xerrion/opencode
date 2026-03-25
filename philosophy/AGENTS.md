## Code Philosophy - ZERO EXCEPTIONS

**Every code change requires a loaded philosophy. No load, no code. If you already started writing - stop, load it, then resume.**

### 1. Load Before You Touch Code

Pick by task. When in doubt, load both.

| Task | Skill to load |
|------|---------------|
| React hooks, data transforms, validation, error handling, business logic | `code-philosophy` |
| Styling, layout, colors, typography, animation, spacing | `frontend-philosophy` |
| Component with both logic and visual work | Both |

### 2. Implement Against the Philosophy

Not beside it. Not after it. The philosophy defines what correct code looks like. Refactor until compliant - do not ship violations.

### 3. Name What You Checked

Before marking done, explicitly list which laws/pillars your code satisfies. Not "checklist passed" - name them:

- **Code**: Early Exit, Parse Don't Validate, Atomic Predictability, Fail Fast, Intentional Naming
- **Frontend**: Typography, Color, Motion, Composition, Atmosphere

Omitting this step means the task is not done.
