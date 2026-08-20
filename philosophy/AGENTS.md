# Code Philosophy

**Every code change requires a loaded philosophy. If you have already started writing without one - stop, load it, then resume.**

The load happens *before* the code because its purpose is to shape what you write, not to grade it afterwards. A philosophy consulted after the fact becomes a checklist you rationalise against; consulted first, it changes the shape of the first draft and there is nothing to rationalise.

## 1. Load Before You Touch Code

Pick by task. When in doubt, load both.

| Task                                                                   | Skill to load             |
| ---------------------------------------------------------------------- | ------------------------- |
| Hooks, data transforms, validation, error handling, business logic     | `code-philosophy`         |
| Styling, layout, colors, typography, animation, spacing                | `frontend-philosophy`     |
| System design, new modules, API shape, dependency direction, data flow | `architecture-philosophy` |
| Component with both logic and visual work                              | Both                      |

WoW addon work is the specialized exception: the `wow-addon` agent loads `wow-addon-toolkit` / `wow-frame-api` and hands findings to the implementer, who loads `code-philosophy` itself. Do not attempt to load domain skills outside your permission grant.

### Agent-Act Discipline

The philosophies above govern what good code looks like. A second kind governs the act you are performing - implementing, reviewing, writing prose, researching, bookkeeping. Load your act-discipline skill in addition to the code-shape skills the task calls for.

Your own agent file names which one and says when to load it.

## 2. Implement Against the Philosophy

Not beside it. Not after it. The philosophy defines what correct code looks like. Refactor until compliant - do not ship violations.

## 3. Name What You Checked

Before marking done, list which laws/pillars your code satisfies. Naming them forces you to re-read the code against each one; "checklist passed" does not, which is why it is not accepted:

- **Code**: Early Exit (Guard Clauses), Parse, Don't Validate, Fail Fast, Fail Loud, Intentional Naming & Interfaces, Comment Hygiene
- **Frontend**: Typography, Color, Motion, Composition, Atmosphere
- **Architecture**: Follow the Grain, Strict Layer Direction, Justifiable Indirection, Design APIs for the Caller, Atomic Predictability, Honest Contracts
- **Specialized domains** (e.g. WoW, ServiceNow): name the specific sections of the loaded domain skill you applied (e.g. Anchor System, Taint Avoidance, Frame Pooling from `wow-frame-api`) - do not invent law names the skill does not define.
- **Act discipline**: name the laws or principles from the act-discipline skill your agent file told you to load.

Omitting this step means the task is not done.
